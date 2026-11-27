import Foundation
import AcodeCurl

struct FTPEntry {
    var name: String
    var size: Int64 = 0
    var directory = false
    var file = false
    var link: String?
    var user: String?
    var group: String?
    var links = 0
    var readable = true
    var writable = true
    var modified: Double = 0

    init(_ info: curl_fileinfo) {
        name = Self.string(info.filename) ?? ""
        size = Int64(info.size)
        directory = info.filetype == CURLFILETYPE_DIRECTORY
        file = info.filetype == CURLFILETYPE_FILE
        if info.filetype == CURLFILETYPE_SYMLINK { link = Self.string(info.strings.target) ?? "" }
        user = Self.string(info.strings.user); group = Self.string(info.strings.group)
        links = info.hardlinks
        if info.flags & UInt32(CURLFINFOFLAG_KNOWN_PERM) != 0 {
            readable = info.perm & 0o400 != 0; writable = info.perm & 0o200 != 0
        }
        modified = Self.date(Self.string(info.strings.time) ?? "")
    }

    init?(facts response: String, path: String) {
        guard let line = response.components(separatedBy: .newlines).map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) }).first(where: { $0.lowercased().hasPrefix("type=") || $0.lowercased().contains(";type=") }),
              let separator = line.firstIndex(of: " ") else { return nil }
        let facts = Dictionary(line[..<separator].split(separator: ";").compactMap { part -> (String, String)? in
            let pair = part.split(separator: "=", maxSplits: 1)
            return pair.count == 2 ? (pair[0].lowercased(), String(pair[1])) : nil
        }, uniquingKeysWith: { _, last in last })
        name = (path as NSString).lastPathComponent
        let type = facts["type"]?.lowercased() ?? ""
        directory = ["dir", "cdir", "pdir"].contains(type); file = type == "file"
        if type.hasPrefix("os.unix=slink") { link = facts["type"]?.split(separator: ":", maxSplits: 1).dropFirst().first.map(String.init) ?? "" }
        size = Int64(facts["size"] ?? "") ?? 0
        user = facts["unix.owner"] ?? facts["unix.uid"]; group = facts["unix.group"] ?? facts["unix.gid"]
        links = Int(facts["unix.nlink"] ?? "") ?? 0
        if let permissions = facts["perm"] {
            readable = permissions.contains(directory ? "l" : "r")
            writable = permissions.contains(directory ? "c" : "w") || permissions.contains("a")
        }
        if let mode = facts["unix.mode"], let bits = UInt32(mode, radix: 8) { readable = bits & 0o400 != 0; writable = bits & 0o200 != 0 }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMddHHmmss"
        if let timestamp = facts["modify"], let date = formatter.date(from: String(timestamp.prefix(14))) { modified = date.timeIntervalSince1970 * 1000 }
    }

    func json(path: String, target: FTPEntry? = nil) -> [String: Any] {
        ["name": name, "length": size, "url": path, "isFile": target?.file ?? file,
         "isDirectory": target?.directory ?? directory, "isLink": link != nil, "link": link as Any? ?? NSNull(),
         "isValid": true, "isUnknown": !file && !directory && link == nil, "linkCount": links,
         "user": user as Any? ?? NSNull(), "group": group as Any? ?? NSNull(),
         "canRead": readable, "canWrite": writable, "lastModified": modified]
    }

    private static func string(_ pointer: UnsafeMutablePointer<CChar>?) -> String? { pointer.map { String(cString: $0) } }

    private static func date(_ value: String) -> Double {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let normalized = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let recent = normalized.contains(":") && !normalized.contains("-")
        let year = Calendar.current.component(.year, from: Date())
        let input = recent ? "\(year) " + normalized : normalized
        for format in recent ? ["yyyy MMM d HH:mm", "yyyy MMM d HH:mm:ss"] : ["MMM d yyyy", "MM-dd-yy hh:mma", "MM-dd-yyyy hh:mma"] {
            formatter.dateFormat = format
            if var date = formatter.date(from: input) {
                if recent && date.timeIntervalSinceNow > 86400 { date = Calendar.current.date(byAdding: .year, value: -1, to: date) ?? date }
                return date.timeIntervalSince1970 * 1000
            }
        }
        return 0
    }
}
