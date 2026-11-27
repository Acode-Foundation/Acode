import Foundation

struct WorkspaceContent {
    let database: WorkspaceDatabase
    static let indexedCharacters = 512 * 1024
    static let indexedBytes = indexedCharacters * 4
    static let binaryExtensions: Set<String> = Set("3gp 7z aab aac apk avi bin bmp class db dex dll doc docx eot exe flac gif gz heic ico jar jpeg jpg keystore m4a m4v mkv mov mp3 mp4 o odt ogg otf pdf png ppt pptx pyc rar so sqlite sqlite3 tar tgz ttf wav webm webp woff woff2 xls xlsx xz zip".split(separator: " ").map(String.init))
    static let textExtensions: Set<String> = Set("astro c cc cfg conf cpp cs css csv cxx dart env go graphql h hpp htm html java js json jsx kt kts less lua md mjs php properties py rb rs sass scss sh sql svg swift toml ts tsx txt vue xml yaml yml".split(separator: " ").map(String.init))
    static let binaryMime: Set<String> = Set("application/java-archive application/java-vm application/octet-stream application/pdf application/vnd.android.package-archive application/zip application/x-7z-compressed application/x-rar-compressed application/x-sqlite3 application/x-tar application/x-xz".split(separator: " ").map(String.init))
    static let textMime: Set<String> = Set("application/javascript application/json application/ld+json application/sql application/typescript application/x-javascript application/x-php application/x-sh application/x-yaml application/xhtml+xml application/xml image/svg+xml".split(separator: " ").map(String.init))

    func get(_ entry: WorkspaceEntry, overlays: [String: String], encoding: String, useIndex: Bool, large: Bool, job: WorkspaceJob) throws -> String? {
        _ = try AppFiles.shared.resolve(entry.url)
        if let text = overlays[entry.url] { return text }
        if useIndex, let cache = try database.rows("SELECT * FROM content WHERE url = ?", [entry.url]).first,
           (entry.size == 0 || (cache["size"] as? NSNumber)?.int64Value == entry.size),
           (entry.modified == 0 || (cache["modified_date"] as? NSNumber)?.doubleValue == entry.modified) { return cache["text"] as? String }
        if useIndex && !large, let text = try index(entry, encoding: encoding, job: job) { return text }
        let limit = (large ? 128 : 16) * 1024 * 1024
        return try read(entry, encoding: encoding, bytes: limit, characters: limit, job: job)
    }

    func index(_ entry: WorkspaceEntry, encoding: String, job: WorkspaceJob) throws -> String? {
        guard let text = try read(entry, encoding: encoding, bytes: Self.indexedBytes, characters: Self.indexedCharacters, job: job) else { return nil }
        try database.execute("INSERT OR REPLACE INTO content VALUES (?, ?, ?, ?, ?)", [entry.url, entry.size, entry.modified, encoding, text])
        return text
    }

    private func read(_ entry: WorkspaceEntry, encoding: String, bytes limit: Int, characters: Int, job: WorkspaceJob) throws -> String? {
        guard !entry.directory, !Self.isBinary(entry), entry.size <= limit else { return nil }
        let url = try AppFiles.shared.resolve(entry.url)
        let bytes = try AppFiles.shared.coordinate(url) { url in
            let input = try FileHandle(forReadingFrom: url)
            defer { try? input.close() }
            var data = Data()
            while data.count <= limit {
                try job.check()
                guard let next = try input.read(upToCount: min(65536, limit + 1 - data.count)), !next.isEmpty else { break }
                data.append(next)
            }
            return data
        }
        guard bytes.count <= limit else { return nil }
        let detected = Self.encoding(bytes, fallback: encoding)
        if detected != .utf16LittleEndian && detected != .utf16BigEndian && detected != .utf32 && detected != .utf32LittleEndian && detected != .utf32BigEndian && Self.looksBinary(bytes) { return nil }
        let text = detected == .utf8 ? String(decoding: bytes, as: UTF8.self) : String(data: bytes, encoding: detected)
        guard let text, text.utf16.count <= characters, !text.utf16.prefix(2048).contains(where: { $0 <= 8 || $0 == 11 || (14...31).contains($0) || $0 == 127 }) else { return nil }
        return text
    }

    static func isBinary(_ entry: WorkspaceEntry) -> Bool {
        if entry.directory { return false }
        let mime = entry.mime.lowercased().split(separator: ";").first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        let parts = entry.name.lowercased().split(separator: ".", omittingEmptySubsequences: false)
        if mime.hasPrefix("text/") || textMime.contains(mime) || (parts.count > 1 && textExtensions.contains(String(parts.last!))) { return false }
        if ["audio/", "font/", "image/", "model/", "video/"].contains(where: { mime.hasPrefix($0) }) || binaryMime.contains(mime) { return true }
        return parts.count > 1 && binaryExtensions.contains(String(parts.last!)) || parts.count > 2 && binaryExtensions.contains(parts.suffix(2).joined(separator: "."))
    }

    private static func encoding(_ bytes: Data, fallback: String) -> String.Encoding {
        if bytes.starts(with: [0xef, 0xbb, 0xbf]) { return .utf8 }
        if bytes.starts(with: [0xff, 0xfe]) { return .utf16LittleEndian }
        if bytes.starts(with: [0xfe, 0xff]) { return .utf16BigEndian }
        let sample = Array(bytes.prefix(8192))
        if sample.count >= 8 {
            let pairs = sample.count / 2
            let even = stride(from: 0, to: pairs * 2, by: 2).filter { sample[$0] == 0 }.count
            let odd = stride(from: 1, to: pairs * 2, by: 2).filter { sample[$0] == 0 }.count
            if Double(odd) > Double(pairs) * 0.35 && Double(even) < Double(pairs) * 0.05 { return .utf16LittleEndian }
            if Double(even) > Double(pairs) * 0.35 && Double(odd) < Double(pairs) * 0.05 { return .utf16BigEndian }
        }
        return (try? FileContents.encoding(fallback)) ?? .utf8
    }

    private static func looksBinary(_ bytes: Data) -> Bool {
        let sample = bytes.prefix(8192)
        if sample.contains(0) { return true }
        let control = sample.filter { $0 < 32 && ![9, 10, 13, 12].contains($0) }.count
        let high = sample.filter { $0 >= 128 }.count
        return Double(control) > max(8, Double(sample.count) * 0.02) && Double(high) < Double(sample.count) * 0.5
    }
}
