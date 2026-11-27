import Foundation
import CoreFoundation

struct FileContents {
    static func encoding(_ name: String) throws -> String.Encoding {
        let value = CFStringConvertIANACharSetNameToEncoding(name as CFString)
        guard value != kCFStringEncodingInvalidId else { throw FileFailure(5) }
        return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(value))
    }

    static func availableEncodings() -> [String: Any] {
        var result: [String: Any] = [:]
        for value in String.availableStringEncodings {
            let code = CFStringConvertNSStringEncodingToEncoding(value.rawValue)
            guard let label = CFStringConvertEncodingToIANACharSetName(code) as String? else { continue }
            let name = label.uppercased()
            result[name] = ["name": name, "label": name, "aliases": [label]]
        }
        return result
    }

    static func perform(_ action: String, url: URL, args: [Any], callback: Callback) throws {
        let writing = action == "write" || action == "truncate"
        try AppFiles.shared.coordinate(url, writing: writing) { url in
            if action == "write" {
                let data: Data
                if args[safe: 3] as? Bool == true {
                    guard let value = args[safe: 1] as? String, let bytes = Data(base64Encoded: value) else { throw FileFailure(5) }
                    data = bytes
                } else { data = Data((args[safe: 1] as? String ?? "").utf8) }
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                let requested = max(0, args[safe: 2] as? Int ?? 0)
                let offset = min(UInt64(requested), try handle.seekToEnd())
                try handle.seek(toOffset: offset)
                try handle.write(contentsOf: data)
                try handle.truncate(atOffset: offset + UInt64(data.count))
                callback.success(data.count)
            } else if action == "truncate" {
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                // Android reports UNKNOWN_ERR for negative truncate lengths.
                guard let requested = args[safe: 1] as? Int, requested >= 0 else { throw FileFailure(1000) }
                let size = try handle.seekToEnd()
                let length = min(UInt64(requested), size)
                try handle.truncate(atOffset: length)
                callback.success(length)
            } else {
                let handle = try FileHandle(forReadingFrom: url)
                defer { try? handle.close() }
                let index = action == "readAsText" ? 2 : 1
                let size = Int(try handle.seekToEnd())
                let start = min(size, max(0, args[safe: index] as? Int ?? 0))
                let requestedEnd = args[safe: index + 1] as? Int ?? -1
                let end = requestedEnd < 0 ? size : min(size, requestedEnd)
                try handle.seek(toOffset: UInt64(start))
                let bytes = try handle.read(upToCount: max(0, end - start)) ?? Data()
                switch action {
                case "readAsArrayBuffer": callback.successBinary(bytes)
                case "readAsBinaryString": callback.success(String(bytes: bytes, encoding: .isoLatin1) ?? "")
                case "readAsDataURL": callback.success("data:\(AppFiles.shared.mimeType(url));base64,\(bytes.base64EncodedString())")
                default:
                    guard let value = String(data: bytes, encoding: try encoding(args[safe: 1] as? String ?? "UTF-8")) else { throw FileFailure(5) }
                    callback.success(value)
                }
            }
        }
    }
}
