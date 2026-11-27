import Foundation
import CSSH2
import Darwin

final class SSHCancellation {
    private let lock = NSLock()
    private var cancelled = false
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    func check() throws {
        lock.lock(); defer { lock.unlock() }
        if cancelled { throw SSHFailure.cancelled }
    }
}

final class SSHConnection {
    private static let initialized = libssh2_init(0)
    let session: OpaquePointer
    let cancellation: SSHCancellation
    private var socket: Int32 = -1
    private var deadline = Date.distantFuture
    private var closed = false

    init(cancellation: SSHCancellation) throws {
        guard Self.initialized == 0, let session = libssh2_session_init_ex(nil, nil, nil, nil) else { throw SecretFailure("Could not initialize SSH") }
        self.session = session
        self.cancellation = cancellation
        libssh2_session_set_blocking(session, 0)
    }

    deinit { close() }

    func connect(_ profile: SSHProfile, timeout: TimeInterval, verify: (Data, String) throws -> Void) throws {
        begin(timeout: timeout)
        socket = try connectSocket(host: profile.hostname, port: profile.port)
        try check { libssh2_session_handshake(session, socket) }
        var length = 0, type: Int32 = 0
        guard let key = libssh2_session_hostkey(session, &length, &type), length > 0 else { throw SecretFailure("SSH server did not provide a host key") }
        let algorithms = [1: "ssh-rsa", 2: "ssh-dss", 3: "ecdsa-sha2-nistp256", 4: "ecdsa-sha2-nistp384", 5: "ecdsa-sha2-nistp521", 6: "ssh-ed25519"]
        try verify(Data(bytes: key, count: length), algorithms[Int(type)] ?? "unknown")
        begin(timeout: timeout)
        if profile.authType == "key" {
            try profile.privateKey.withUnsafeBytes { bytes in
                let key = bytes.bindMemory(to: CChar.self)
                try check { libssh2_userauth_publickey_frommemory(session, profile.username, profile.username.utf8.count, nil, 0, key.baseAddress, key.count, profile.passphrase) }
            }
        } else {
            try check { libssh2_userauth_password_ex(session, profile.username, UInt32(profile.username.utf8.count), profile.password, UInt32(profile.password.utf8.count), nil) }
        }
    }

    func begin(timeout: TimeInterval? = 30) { deadline = timeout.map { Date().addingTimeInterval($0) } ?? .distantFuture }

    var isConnected: Bool {
        guard !closed, socket >= 0, (try? cancellation.check()) != nil else { return false }
        var byte: UInt8 = 0
        let count = recv(socket, &byte, 1, MSG_PEEK | MSG_DONTWAIT)
        return count > 0 || (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK))
    }

    func check(_ operation: () -> Int32) throws {
        let result = try integer { Int(operation()) }
        if result < 0 { throw failure() }
    }

    func integer(_ operation: () -> Int) throws -> Int {
        while true {
            try cancellation.check()
            let result = operation()
            if result != LIBSSH2_ERROR_EAGAIN { return result }
            try wait()
        }
    }

    func pointer(_ operation: () -> OpaquePointer?) throws -> OpaquePointer {
        while true {
            try cancellation.check()
            if let result = operation() { return result }
            guard libssh2_session_last_errno(session) == LIBSSH2_ERROR_EAGAIN else { throw failure() }
            try wait()
        }
    }

    func wait() throws {
        try cancellation.check()
        guard Date() < deadline else {
            invalidate()
            throw SecretFailure("SSH operation timed out")
        }
        let directions = libssh2_session_block_directions(session)
        var events: Int16 = 0
        if directions & LIBSSH2_SESSION_BLOCK_INBOUND != 0 { events |= Int16(POLLIN) }
        if directions & LIBSSH2_SESSION_BLOCK_OUTBOUND != 0 { events |= Int16(POLLOUT) }
        if events == 0 { events = Int16(POLLIN) }
        var descriptor = pollfd(fd: socket, events: events, revents: 0)
        let result = poll(&descriptor, 1, 50)
        if (result < 0 && errno != EINTR) || descriptor.revents & Int16(POLLERR | POLLNVAL) != 0 {
            invalidate(); throw SecretFailure("SSH connection was interrupted")
        }
    }

    func failure() -> Error {
        var message: UnsafeMutablePointer<CChar>?
        let code = libssh2_session_last_error(session, &message, nil, 0)
        if [LIBSSH2_ERROR_SOCKET_SEND, LIBSSH2_ERROR_SOCKET_RECV, LIBSSH2_ERROR_SOCKET_DISCONNECT,
            LIBSSH2_ERROR_CHANNEL_CLOSED, LIBSSH2_ERROR_PROTO, LIBSSH2_ERROR_DECRYPT,
            LIBSSH2_ERROR_INVALID_MAC, LIBSSH2_ERROR_TIMEOUT].contains(code) { invalidate() }
        return SecretFailure(message.map { String(cString: $0) } ?? "SSH operation failed")
    }

    @discardableResult
    func cleanup(_ operation: () -> Int32) -> Int32 {
        begin(timeout: 2)
        while true {
            if (try? cancellation.check()) == nil, socket >= 0 { shutdown(socket, SHUT_RDWR) }
            let result = operation()
            if result != LIBSSH2_ERROR_EAGAIN { return result }
            do { try wait() }
            catch { if socket >= 0 { shutdown(socket, SHUT_RDWR) } }
        }
    }

    func close() {
        guard !closed else { return }
        closed = true
        if socket >= 0 { shutdown(socket, SHUT_RDWR) }
        cleanup { libssh2_session_free(session) }
        if socket >= 0 { Darwin.close(socket); socket = -1 }
    }

    private func invalidate() {
        cancellation.cancel()
        if socket >= 0 { shutdown(socket, SHUT_RDWR) }
    }

    private func connectSocket(host: String, port: Int) throws -> Int32 {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM; hints.ai_protocol = IPPROTO_TCP
        var addresses: UnsafeMutablePointer<addrinfo>?
        let result = getaddrinfo(host, String(port), &hints, &addresses)
        guard result == 0 else { throw SecretFailure(String(cString: gai_strerror(result))) }
        defer { freeaddrinfo(addresses) }
        var address = addresses
        while let current = address {
            try cancellation.check()
            let info = current.pointee
            address = info.ai_next
            let descriptor = Darwin.socket(info.ai_family, info.ai_socktype, info.ai_protocol)
            if descriptor < 0 { continue }
            guard fcntl(descriptor, F_SETFL, O_NONBLOCK) == 0 else { Darwin.close(descriptor); continue }
            var enabled: Int32 = 1
            setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &enabled, socklen_t(MemoryLayout<Int32>.size))
            let connected = Darwin.connect(descriptor, info.ai_addr, info.ai_addrlen)
            if connected == 0 { return descriptor }
            if errno == EINPROGRESS {
                do {
                    while Date() < deadline {
                        try cancellation.check()
                        var poller = pollfd(fd: descriptor, events: Int16(POLLOUT), revents: 0)
                        if poll(&poller, 1, 50) <= 0 { continue }
                        var error: Int32 = 0, size = socklen_t(MemoryLayout<Int32>.size)
                        getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &error, &size)
                        if error == 0 { return descriptor }
                        break
                    }
                } catch { Darwin.close(descriptor); throw error }
            }
            Darwin.close(descriptor)
        }
        throw SecretFailure("Could not connect to SSH host")
    }
}
