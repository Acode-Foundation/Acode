import Foundation

struct LocalHTTPRequest {
    let method: String
    let target: String
    let headers: [String: String]
    let body: Data

    var payload: [String: Any] {
        let parts = target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        return ["method": method, "path": String(parts[0]).removingPercentEncoding ?? String(parts[0]),
                "query": parts.count > 1 ? String(parts[1]) : "", "headers": headers,
                "body": String(decoding: body, as: UTF8.self)]
    }
}

struct LocalHTTPParser {
    static let headerLimit = 64 * 1024
    static let bodyLimit = 64 * 1024 * 1024
    private var buffer = Data()
    private var head: (method: String, target: String, headers: [String: String])?
    private var body = Data()
    private var chunkSize: Int?
    private var trailers = false
    private(set) var expectsContinue = false

    mutating func append(_ data: Data) throws -> LocalHTTPRequest? {
        buffer.append(data)
        if head == nil {
            guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                guard buffer.count <= Self.headerLimit else { throw LocalHTTPError(431) }
                return nil
            }
            guard end.lowerBound - buffer.startIndex <= Self.headerLimit else { throw LocalHTTPError(431) }
            try parseHead(Data(buffer[..<end.lowerBound]))
            buffer = Data(buffer[end.upperBound...])
        }
        guard let head else { return nil }
        if head.headers["transfer-encoding"] != nil {
            guard try readChunks() else { return nil }
        } else {
            let length = Int(head.headers["content-length"] ?? "0") ?? 0
            guard buffer.count >= length else { return nil }
            body = Data(buffer.prefix(length))
        }
        return LocalHTTPRequest(method: head.method, target: head.target, headers: head.headers, body: body)
    }

    private mutating func parseHead(_ data: Data) throws {
        let lines = String(decoding: data, as: UTF8.self).components(separatedBy: "\r\n")
        let first = (lines.first ?? "").split(separator: " ", omittingEmptySubsequences: false)
        guard first.count == 3, Self.isToken(String(first[0])), first[1].hasPrefix("/"),
              ["HTTP/1.1", "HTTP/1.0"].contains(first[2]),
              !first[1].contains(where: { $0.asciiValue.map { $0 < 33 || $0 == 127 } ?? false }) else { throw LocalHTTPError(400) }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { throw LocalHTTPError(400) }
            let key = String(line[..<colon]).lowercased()
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            guard Self.isToken(key), !value.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" }) else { throw LocalHTTPError(400) }
            if headers[key] != nil {
                guard !["content-length", "transfer-encoding", "host"].contains(key) else { throw LocalHTTPError(400) }
                headers[key]! += (key == "cookie" ? "; " : ", ") + value
            } else { headers[key] = value }
        }
        if let encoding = headers["transfer-encoding"] {
            guard encoding.lowercased() == "chunked", headers["content-length"] == nil else { throw LocalHTTPError(400) }
        }
        if let text = headers["content-length"] {
            guard !text.isEmpty, text.allSatisfy({ $0.isASCII && $0.isNumber }), let length = Int(text), length >= 0 else { throw LocalHTTPError(400) }
            guard length <= Self.bodyLimit else { throw LocalHTTPError(413) }
        }
        if let expectation = headers["expect"] {
            guard expectation.lowercased() == "100-continue" else { throw LocalHTTPError(417) }
            expectsContinue = true
        }
        head = (String(first[0]), String(first[1]), headers)
    }

    private mutating func readChunks() throws -> Bool {
        while true {
            if trailers {
                if buffer.starts(with: Data("\r\n".utf8)) { return true }
                if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                    guard end.upperBound - buffer.startIndex <= Self.headerLimit else { throw LocalHTTPError(431) }
                    return true
                }
                guard buffer.count <= Self.headerLimit else { throw LocalHTTPError(431) }
                return false
            }
            if chunkSize == nil {
                guard let end = buffer.range(of: Data("\r\n".utf8)) else {
                    guard buffer.count < Self.headerLimit else { throw LocalHTTPError(400) }
                    return false
                }
                let text = String(decoding: buffer[..<end.lowerBound], as: UTF8.self).split(separator: ";", maxSplits: 1)[safe: 0].map(String.init) ?? ""
                guard !text.isEmpty, text.allSatisfy({ $0.isHexDigit }), let size = Int(text, radix: 16) else { throw LocalHTTPError(400) }
                guard size <= Self.bodyLimit - body.count else { throw LocalHTTPError(413) }
                buffer = Data(buffer[end.upperBound...])
                if size == 0 { trailers = true; continue }
                chunkSize = size
            }
            guard let size = chunkSize, buffer.count >= size + 2 else { return false }
            let end = buffer.startIndex + size
            guard buffer[end] == 13, buffer[end + 1] == 10 else { throw LocalHTTPError(400) }
            body.append(buffer.prefix(size))
            buffer = Data(buffer.dropFirst(size + 2))
            chunkSize = nil
        }
    }

    static func isToken(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.allSatisfy { byte in
            (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte) || "!#$%&'*+-.^_`|~".utf8.contains(byte)
        }
    }
}

struct LocalHTTPError: Error {
    let status: Int
    init(_ status: Int) { self.status = status }
}
