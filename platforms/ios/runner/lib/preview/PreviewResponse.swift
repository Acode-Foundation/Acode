import CryptoKit
import Foundation

enum PreviewResponse {
    static func send(_ value: [String: Any], request: LocalHTTPRequest, client: LocalHTTPConnection) throws {
        var headers = value["headers"] as? [String: String] ?? [:]
        if let path = value["path"] as? String {
            let files = AppFiles.shared
            let url = try files.resolve(path)
            try files.coordinate(url) { item in
                let attributes = try item.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey])
                guard attributes.isRegularFile == true else { throw FileFailure(2) }
                let size = UInt64(attributes.fileSize ?? 0)
                let signature = "\(item.absoluteString)|\(attributes.contentModificationDate?.timeIntervalSince1970 ?? 0)|\(size)"
                let etag = "\"" + SHA256.hash(data: Data(signature.utf8)).map { String(format: "%02x", $0) }.joined() + "\""
                if !headers.keys.contains(where: { $0.lowercased() == "content-type" }) { headers["Content-Type"] = files.mimeType(item) }
                headers["ETag"] = etag
                headers["Accept-Ranges"] = "bytes"
                let rangeAllowed = request.headers["if-range"].map { $0 == etag } ?? true
                let range = rangeAllowed ? request.headers["range"] : nil
                let slice: Range<UInt64>
                do { slice = try byteRange(range, size: size) }
                catch {
                    headers["Content-Range"] = "bytes */\(size)"
                    client.respond(status: 416, headers: headers); return
                }
                if let conditional = request.headers["if-none-match"], conditional == "*" || conditional.components(separatedBy: ",").contains(where: { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "W/", with: "") == etag }) {
                    client.respond(status: 304, headers: headers); return
                }
                let partial = range != nil && range!.hasPrefix("bytes=") && !range!.contains(",")
                if partial { headers["Content-Range"] = "bytes \(slice.lowerBound)-\(slice.upperBound - 1)/\(size)" }
                let file = try FileHandle(forReadingFrom: item)
                try file.seek(toOffset: slice.lowerBound)
                client.startResponse(status: partial ? 206 : 200, headers: headers, length: slice.upperBound - slice.lowerBound)
                client.sendFile(file, count: slice.upperBound - slice.lowerBound)
            }
        } else {
            let status = value["status"] as? Int ?? 200
            guard (200...599).contains(status) else { throw LocalHTTPError(500) }
            if !headers.keys.contains(where: { $0.lowercased() == "content-type" }) { headers["Content-Type"] = "text/plain; charset=utf-8" }
            if let name = headers.keys.first(where: { $0.lowercased() == "content-type" }), let type = headers[name], !type.lowercased().contains("charset=") {
                headers[name] = type + "; charset=utf-8"
            }
            let body = [204, 304].contains(status) ? Data() : Data((value["body"] as? String ?? "").utf8)
            client.respond(status: status, headers: headers, body: body)
        }
    }

    private static func byteRange(_ range: String?, size: UInt64) throws -> Range<UInt64> {
        guard let range, range.hasPrefix("bytes="), !range.contains(",") else { return 0..<size }
        let pair = range.dropFirst(6).split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard pair.count == 2, size > 0 else { throw LocalHTTPError(416) }
        if pair[0].isEmpty {
            guard let suffix = UInt64(pair[1]), suffix > 0 else { throw LocalHTTPError(416) }
            return (size - min(size, suffix))..<size
        }
        guard let start = UInt64(pair[0]), start < size else { throw LocalHTTPError(416) }
        let end: UInt64
        if pair[1].isEmpty { end = size - 1 }
        else if let requested = UInt64(pair[1]), requested >= start { end = min(requested, size - 1) }
        else { throw LocalHTTPError(416) }
        return start..<(end + 1)
    }
}
