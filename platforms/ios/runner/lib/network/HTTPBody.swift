import Foundation

struct HTTPBody {
    let data: Data
    let type: String

    static func encode(_ value: Any?, serializer: String) throws -> HTTPBody {
        let object = value as? [String: Any] ?? [:]
        switch serializer {
        case "json":
            return HTTPBody(data: try JSONSerialization.data(withJSONObject: value ?? [:], options: [.fragmentsAllowed]), type: "application/json; charset=UTF-8")
        case "utf8": return HTTPBody(data: Data((object["text"] as? String ?? "").utf8), type: "text/plain; charset=UTF-8")
        case "raw":
            guard let raw = value as? String, let data = Data(base64Encoded: raw) else { throw HTTPFailure(status: -1, message: "Invalid binary request body") }
            return HTTPBody(data: data, type: "application/octet-stream")
        case "urlencoded":
            let body = object.sorted(by: { $0.key < $1.key }).map { "\(escape($0.key))=\(escape(String(describing: $0.value)))" }.joined(separator: "&")
            return HTTPBody(data: Data(body.utf8), type: "application/x-www-form-urlencoded; charset=UTF-8")
        case "multipart":
            guard let buffers = object["buffers"] as? [String], let names = object["names"] as? [String],
                  let fileNames = object["fileNames"] as? [Any], let types = object["types"] as? [String],
                  buffers.count == names.count, names.count == fileNames.count, names.count == types.count else {
                throw HTTPFailure(status: -1, message: "Invalid multipart body")
            }
            return try multipart(buffers.indices.map { index in
                guard let data = Data(base64Encoded: buffers[index]) else { throw HTTPFailure(status: -1, message: "Invalid multipart data") }
                return (names[index], fileNames[index] as? String, types[index], data)
            })
        default: throw HTTPFailure(status: -1, message: "Unknown serializer: \(serializer)")
        }
    }

    static func files(paths: [String], names: [String]) throws -> HTTPBody {
        guard !paths.isEmpty, names.count == paths.count else { throw HTTPFailure(status: -1, message: "File paths and field names must match") }
        let files = AppFiles.shared
        return try multipart(paths.indices.map { index in
            let url = try files.resolve(paths[index])
            let data = try files.coordinate(url) { try Data(contentsOf: $0) }
            return (names[index], url.lastPathComponent, files.mimeType(url), data)
        })
    }

    private static func multipart(_ parts: [(String, String?, String, Data)]) -> HTTPBody {
        let boundary = "Acode-" + UUID().uuidString
        var data = Data()
        for (name, filename, type, bytes) in parts {
            var header = "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(quote(name))\""
            if let filename { header += "; filename=\"\(quote(filename))\"" }
            header += "\r\nContent-Type: \(type.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: ""))\r\n\r\n"
            data.append(Data(header.utf8)); data.append(bytes); data.append(Data("\r\n".utf8))
        }
        data.append(Data("--\(boundary)--\r\n".utf8))
        return HTTPBody(data: data, type: "multipart/form-data; boundary=\(boundary)")
    }

    private static func quote(_ value: String) -> String {
        value.replacingOccurrences(of: "\r", with: "%0D").replacingOccurrences(of: "\n", with: "%0A").replacingOccurrences(of: "\"", with: "%22")
    }

    private static func escape(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) ?? ""
    }
}
