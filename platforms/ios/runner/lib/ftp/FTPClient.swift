import Foundation
import AcodeCurl

final class FTPClient {
    static let initialized = curl_global_init(Int(CURL_GLOBAL_DEFAULT))
    let profile: FTPProfile
    let cancellation = FTPCancellation()
    let queue = DispatchQueue(label: "app.acode.ftp.client", qos: .userInitiated)
    var directory = "/"
    private let handle: UnsafeMutableRawPointer
    private let certificate: Data?
    private let connectTo: String?
    private var started = false

    init(_ profile: FTPProfile, certificate: Data? = nil, connectTo: String? = nil) throws {
        guard Self.initialized == CURLE_OK, let handle = curl_easy_init() else { throw FTPFailure("Cannot initialize FTP") }
        self.profile = profile; self.handle = handle; self.certificate = certificate
        self.connectTo = connectTo
    }

    deinit { curl_easy_cleanup(handle) }

    func connect() throws {
        if started { try command("NOOP"); return }
        _ = try perform("", commands: ["NOOP"])
        if let home = acode_curl_directory(handle) { directory = String(cString: home) }
        started = true
    }

    func path(_ value: String) throws -> String {
        try FTPProfile.validate(value)
        return ((value.hasPrefix("/") ? value : directory + "/" + value) as NSString).standardizingPath
    }

    @discardableResult
    func command(_ value: String, allowFailure: Bool = false) throws -> String {
        try FTPProfile.validate(value)
        let verb = String(value.prefix { !$0.isWhitespace }).uppercased()
        guard !verb.isEmpty else { throw FTPFailure("Command is required.") }
        let changesDirectory = ["CWD", "CDUP", "XCWD", "XCUP"].contains(verb)
        let request = try perform(directory + "/", commands: [(allowFailure ? "*" : "") + value] + (changesDirectory ? ["PWD"] : []), close: changesDirectory)
        if changesDirectory, let response = request.replies["PWD"], let home = Self.workingDirectory(response) { directory = home }
        return request.replies[verb] ?? ""
    }

    @discardableResult
    func perform(_ remote: String, commands: [String] = [], listing: Bool = false, upload: Bool = false, request supplied: FTPRequest? = nil, close: Bool = false) throws -> FTPRequest {
        try cancellation.check()
        curl_easy_reset(handle)
        let request = supplied ?? FTPRequest(cancellation)
        let context = Unmanaged.passUnretained(request).toOpaque()
        defer {
            set(CURLOPT_VERBOSE, 0)
            acode_curl_debug(handle, nil); acode_curl_progress(handle, nil); acode_curl_chunk(handle, nil)
            for option in [CURLOPT_DEBUGDATA, CURLOPT_XFERINFODATA, CURLOPT_CHUNK_DATA, CURLOPT_WRITEDATA, CURLOPT_READDATA] {
                acode_curl_pointer(handle, option, nil)
            }
        }
        let url = try profile.url(remote)
        var destinations: UnsafeMutablePointer<curl_slist>?
        defer { acode_curl_pointer(handle, CURLOPT_CONNECT_TO, nil); curl_slist_free_all(destinations) }
        // Test listeners use ephemeral ports while preserving the profile's TLS mode and hostname.
        if let connectTo {
            destinations = curl_slist_append(nil, connectTo)
            acode_curl_pointer(handle, CURLOPT_CONNECT_TO, destinations)
        }
        set(CURLOPT_URL, listing ? String(url.dropLast(3)) + "*" : url)
        set(CURLOPT_USERNAME, profile.username); set(CURLOPT_PASSWORD, profile.password)
        set(CURLOPT_PROTOCOLS_STR, "ftp,ftps")
        set(CURLOPT_NOSIGNAL, 1); set(CURLOPT_CONNECTTIMEOUT, 30); set(CURLOPT_SERVER_RESPONSE_TIMEOUT, 30)
        set(CURLOPT_TCP_KEEPALIVE, 1); set(CURLOPT_TCP_KEEPIDLE, 300)
        set(CURLOPT_FTP_FILEMETHOD, Int(CURLFTPMETHOD_SINGLECWD))
        set(CURLOPT_SSL_VERIFYPEER, 1); set(CURLOPT_SSL_VERIFYHOST, 2)
        set(CURLOPT_SSL_OPTIONS, Int(CURLSSLOPT_NATIVE_CA))
        if let certificate {
            set(CURLOPT_SSL_OPTIONS, 0)
            _ = certificate.withUnsafeBytes { acode_curl_ca(handle, $0.baseAddress, $0.count) }
        }
        if profile.secure { set(CURLOPT_USE_SSL, Int(CURLUSESSL_ALL)) }
        if profile.active { set(CURLOPT_FTPPORT, "-") }
        set(CURLOPT_FORBID_REUSE, close ? 1 : 0)
        set(CURLOPT_NOBODY, !commands.isEmpty ? 1 : 0)
        set(CURLOPT_UPLOAD, upload ? 1 : 0)
        set(CURLOPT_WILDCARDMATCH, listing ? 1 : 0)
        if listing { set(CURLOPT_CUSTOMREQUEST, "LIST -a") }
        acode_curl_write(handle, CURLOPT_WRITEFUNCTION, ftpWrite)
        acode_curl_pointer(handle, CURLOPT_WRITEDATA, context)
        acode_curl_read(handle, ftpRead)
        acode_curl_pointer(handle, CURLOPT_READDATA, context)
        acode_curl_write(handle, CURLOPT_HEADERFUNCTION, { _, size, count, _ in size * count })
        acode_curl_debug(handle, { _, type, bytes, count, pointer in
            if let bytes { ftpRequest(pointer).trace(type, bytes: bytes, count: count) }
            return 0
        })
        acode_curl_pointer(handle, CURLOPT_DEBUGDATA, context); set(CURLOPT_VERBOSE, 1)
        acode_curl_progress(handle, { pointer, _, _, _, _ in ftpRequest(pointer).cancellation.cancelled || ftpRequest(pointer).error != nil ? 1 : 0 })
        acode_curl_pointer(handle, CURLOPT_XFERINFODATA, context); set(CURLOPT_NOPROGRESS, 0)
        acode_curl_chunk(handle, { info, pointer, _ in
            if let info { ftpRequest(pointer).entries.append(FTPEntry(info.assumingMemoryBound(to: curl_fileinfo.self).pointee)) }
            return Int(CURL_CHUNK_BGN_FUNC_SKIP)
        })
        acode_curl_pointer(handle, CURLOPT_CHUNK_DATA, context)
        var quotes: UnsafeMutablePointer<curl_slist>?
        defer { curl_slist_free_all(quotes) }
        for command in commands { quotes = curl_slist_append(quotes, command) }
        acode_curl_pointer(handle, CURLOPT_POSTQUOTE, quotes)
        let code = curl_easy_perform(handle)
        if let error = request.error { throw error }
        try cancellation.check()
        let reply = Int(acode_curl_response(handle))
        if listing && code == CURLE_REMOTE_FILE_NOT_FOUND && request.replyCodes["LIST"] == 226 { return request }
        guard code == CURLE_OK else { throw FTPFailure(String(cString: curl_easy_strerror(code)), replyCode: reply) }
        return request
    }

    private func set(_ option: CURLoption, _ value: Int) { acode_curl_long(handle, option, value) }
    private func set(_ option: CURLoption, _ value: String) { acode_curl_string(handle, option, value) }

    private static func workingDirectory(_ response: String) -> String? {
        guard let opening = response.firstIndex(of: "\"") else { return nil }
        var value = "", index = response.index(after: opening)
        while index < response.endIndex {
            let character = response[index]; index = response.index(after: index)
            if character == "\"" {
                guard index < response.endIndex, response[index] == "\"" else { return value }
                index = response.index(after: index)
            }
            value.append(character)
        }
        return nil
    }
}
