import Foundation
import CSSH2

final class SSHChannel {
    let connection: SSHConnection
    let handle: OpaquePointer
    private var decoder = SSHTextDecoder()
    private(set) var readCount = 0

    init(connection: SSHConnection) throws {
        self.connection = connection
        connection.begin()
        handle = try connection.pointer { libssh2_channel_open_ex(connection.session, "session", 7, 2 * 1024 * 1024, 32768, nil, 0) }
        try connection.check { libssh2_channel_handle_extended_data2(handle, LIBSSH2_CHANNEL_EXTENDED_DATA_MERGE) }
    }

    deinit { connection.cleanup { libssh2_channel_free(handle) } }

    func execute(_ command: String) throws -> [String: Any] {
        try connection.check { libssh2_channel_process_startup(handle, "exec", 4, command, UInt32(command.utf8.count)) }
        connection.begin(timeout: nil)
        var result = ""
        while true {
            let text = try read()
            result += text
            if readCount == 0 {
                if ended { break }
                try connection.wait()
            }
        }
        result += decoder.finish()
        try connection.check { libssh2_channel_close(handle) }
        return ["code": Int(libssh2_channel_get_exit_status(handle)), "result": result]
    }

    func shell(columns: Int, rows: Int) throws {
        try connection.check { libssh2_channel_request_pty_ex(handle, "xterm-256color", 14, nil, 0, Int32(columns), Int32(rows), 0, 0) }
        try connection.check { libssh2_channel_process_startup(handle, "shell", 5, nil, 0) }
    }

    func resize(columns: Int, rows: Int) throws {
        connection.begin()
        try connection.check { libssh2_channel_request_pty_size_ex(handle, Int32(columns), Int32(rows), 0, 0) }
    }

    func write(_ text: String) throws {
        try Data(text.utf8).withUnsafeBytes { bytes in
            guard let buffer = bytes.bindMemory(to: CChar.self).baseAddress else { return }
            var offset = 0
            while offset < bytes.count {
                connection.begin()
                let count = try connection.integer { libssh2_channel_write_ex(handle, 0, buffer + offset, bytes.count - offset) }
                guard count > 0 else { throw connection.failure() }
                offset += count
            }
        }
    }

    func read() throws -> String {
        var buffer = [CChar](repeating: 0, count: 32768)
        let count = libssh2_channel_read_ex(handle, 0, &buffer, buffer.count)
        readCount = max(0, count)
        if count == LIBSSH2_ERROR_EAGAIN { return "" }
        guard count >= 0 else { throw connection.failure() }
        return decoder.append(Data(buffer.prefix(count).map { UInt8(bitPattern: $0) }))
    }

    var ended: Bool { libssh2_channel_eof(handle) != 0 }
    var exitCode: Int { Int(libssh2_channel_get_exit_status(handle)) }
    func remainingText() -> String { decoder.finish() }
}

struct SSHTextDecoder {
    private var pending = Data()
    mutating func append(_ data: Data) -> String {
        pending.append(data)
        var length = pending.count
        if length > 0 {
            var start = length - 1
            while start > 0 && pending[start] & 0xc0 == 0x80 && length - start < 4 { start -= 1 }
            let first = pending[start]
            let expected = first & 0xf8 == 0xf0 ? 4 : first & 0xf0 == 0xe0 ? 3 : first & 0xe0 == 0xc0 ? 2 : 1
            if length - start < expected { length = start }
        }
        let text = String(decoding: pending.prefix(length), as: UTF8.self)
        pending = Data(pending.dropFirst(length))
        return text
    }
    mutating func finish() -> String {
        defer { pending.removeAll() }
        return String(decoding: pending, as: UTF8.self)
    }
}
