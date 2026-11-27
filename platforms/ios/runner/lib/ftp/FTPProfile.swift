import Foundation

struct FTPProfile: Equatable {
    let host: String
    let port: Int
    let username: String
    let password: String
    let active: Bool
    let secure: Bool
    var id: String { "\(username)@\(host):\(port)" }

    init(_ args: [Any]) throws {
        host = args[safe: 0] as? String ?? ""
        port = args[safe: 1] as? Int ?? 21
        username = args[safe: 2] as? String ?? ""
        password = args[safe: 3] as? String ?? ""
        let mode = args[safe: 4] as? String ?? "passive"
        let security = args[safe: 5] as? String ?? "ftp"
        active = mode == "active"
        secure = security == "ftps"
        guard !host.isEmpty, (1...65535).contains(port), ["active", "passive"].contains(mode), ["ftp", "ftps"].contains(security) else {
            throw FTPFailure("Invalid FTP connection options")
        }
        try Self.validate(host); try Self.validate(username); try Self.validate(password)
    }

    func url(_ path: String) throws -> String {
        var url = URLComponents()
        url.scheme = secure && port == 990 ? "ftps" : "ftp"
        url.host = host; url.port = port
        let allowed = CharacterSet(charactersIn: "/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        guard let encoded = path.addingPercentEncoding(withAllowedCharacters: allowed) else { throw FTPFailure("Invalid FTP path") }
        url.percentEncodedPath = "/" + encoded
        guard let result = url.url else { throw FTPFailure("Invalid FTP host") }
        return result.absoluteString
    }

    static func validate(_ value: String) throws {
        guard !value.contains("\0"), !value.contains("\r"), !value.contains("\n") else { throw FTPFailure("FTP commands and paths cannot contain line breaks or NUL") }
    }
}

struct FTPFailure: LocalizedError {
    let message: String
    let replyCode: Int
    var errorDescription: String? { message }
    init(_ message: String, replyCode: Int = 0) { self.message = message; self.replyCode = replyCode }
}

final class FTPCancellation {
    private let lock = NSLock()
    private var stopped = false
    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
    func cancel() { lock.lock(); stopped = true; lock.unlock() }
    func check() throws { if cancelled { throw FTPFailure("FTP operation cancelled") } }
}
