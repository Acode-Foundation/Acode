import Foundation
import UniformTypeIdentifiers

final class AppFiles {
    static let shared = AppFiles()
    let manager = FileManager.default
    let data: URL
    let cache: URL
    let documents: URL
    let temporary: URL
    let application = Bundle.main.bundleURL
    private(set) var roots: [String: URL]
    private let lock = NSRecursiveLock()
    private let history = FileRootHistory()

    private init() {
        data = manager.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("NoCloud", isDirectory: true)
        cache = manager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        documents = manager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        temporary = manager.temporaryDirectory
        roots = ["files": data, "cache": cache, "persistent": documents, "temporary": temporary, "application": application]
        for url in [data, cache, documents, temporary] { try? manager.createDirectory(at: url, withIntermediateDirectories: true) }
        var dataDirectory = data
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dataDirectory.setResourceValues(values)
        for (name, bookmark) in UserDefaults.standard.dictionary(forKey: "acode.folderBookmarks") ?? [:] {
            guard let bookmark = bookmark as? Data else { continue }
            var stale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, options: [], bookmarkDataIsStale: &stale), url.startAccessingSecurityScopedResource() {
                roots[name] = url
                if stale { try? remember(url, name: name) }
            }
        }
        history.update(roots)
    }

    func remember(_ url: URL, name: String = UUID().uuidString) throws {
        lock.lock(); defer { lock.unlock() }
        let scoped = url.startAccessingSecurityScopedResource()
        var retained = false
        defer { if scoped && !retained { url.stopAccessingSecurityScopedResource() } }
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        if [data, cache, documents, temporary, application].contains(where: { contains($0, canonical) }) { return }
        guard scoped else {
            if (try? resolve(url.absoluteString)) != nil { return }
            throw FileFailure(2)
        }
        let existing = roots.first { $0.value.standardizedFileURL.resolvingSymlinksInPath() == canonical }
        let key = existing?.key ?? name
        let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        var bookmarks = UserDefaults.standard.dictionary(forKey: "acode.folderBookmarks") ?? [:]
        bookmarks[key] = bookmark
        UserDefaults.standard.set(bookmarks, forKey: "acode.folderBookmarks")
        roots[key] = url
        history.update(roots)
        retained = true
        existing?.value.stopAccessingSecurityScopedResource()
    }

    func resolve(_ path: String, followingFinalSymlink: Bool = true) throws -> URL {
        lock.lock(); defer { lock.unlock() }
        guard let parsed = URL(string: path) else { throw FileFailure(5) }
        let url: URL
        if parsed.scheme == "acode", parsed.host == "localhost", parsed.path.hasPrefix("/__cdvfile_") {
            let component = parsed.pathComponents[1]
            let name = String(component.dropFirst("__cdvfile_".count).dropLast(2))
            guard component.hasSuffix("__"), let root = roots[name] else { throw FileFailure(1) }
            let relative = parsed.pathComponents.dropFirst(2).joined(separator: "/")
            url = relative.isEmpty ? root : root.appendingPathComponent(relative)
        } else if parsed.scheme == "acode", parsed.host == "localhost", ["__file__", "__cache__"].contains(parsed.pathComponents[safe: 1] ?? "") {
            let root = parsed.pathComponents[1] == "__file__" ? documents : cache
            url = root.appendingPathComponent(parsed.pathComponents.dropFirst(2).joined(separator: "/"))
        } else if parsed.isFileURL {
            url = parsed
        } else if path.hasPrefix("/") {
            url = URL(fileURLWithPath: path)
        } else { throw FileFailure(5) }
        let normalized = history.resolve(url, roots: roots).standardizedFileURL
        let canonical = followingFinalSymlink ? normalized.resolvingSymlinksInPath()
            : normalized.deletingLastPathComponent().resolvingSymlinksInPath().appendingPathComponent(normalized.lastPathComponent)
        guard roots.values.contains(where: { contains($0, canonical) }) else { throw FileFailure(2) }
        return canonical
    }

    func entry(_ url: URL) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let info = try resolve(url.absoluteString).resourceValues(forKeys: [.isDirectoryKey])
        let location = try resolve(url.absoluteString, followingFinalSymlink: false)
        guard let (name, root) = roots.sorted(by: { $0.value.path.count > $1.value.path.count }).first(where: { contains($0.value, location) }) else { throw FileFailure(2) }
        let relative = String(location.path.dropFirst(root.standardizedFileURL.resolvingSymlinksInPath().path.count))
        return ["name": location.lastPathComponent, "fullPath": relative.isEmpty ? "/" : relative, "nativeURL": location.absoluteString, "filesystemName": name, "isDirectory": info.isDirectory == true, "isFile": info.isDirectory != true]
    }

    func metadata(_ url: URL) throws -> [String: Any] {
        let values = try resolve(url.absoluteString).resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isDirectoryKey])
        return ["name": url.lastPathComponent, "size": values.fileSize ?? 0, "type": mimeType(url), "lastModifiedDate": (values.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000, "isDirectory": values.isDirectory == true, "isFile": values.isDirectory != true, "url": url.absoluteString, "canRead": manager.isReadableFile(atPath: url.path), "canWrite": manager.isWritableFile(atPath: url.path)]
    }

    func coordinate<T>(_ url: URL, writing: Bool = false, _ operation: (URL) throws -> T) throws -> T {
        var coordinationError: NSError?
        var result: Result<T, Error>?
        let accessor: (URL) -> Void = { item in result = Result { try operation(item) } }
        if writing { NSFileCoordinator().coordinate(writingItemAt: url, options: [], error: &coordinationError, byAccessor: accessor) }
        else { NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError, byAccessor: accessor) }
        if let error = coordinationError { throw error }
        guard let result else { throw FileFailure(4) }
        return try result.get()
    }

    func allRoots() -> [String: URL] {
        lock.lock(); defer { lock.unlock() }
        return roots
    }

    func pathReplacements() -> [[String: String]] {
        lock.lock(); defer { lock.unlock() }
        return history.replacements(roots: roots)
    }

    func mimeType(_ url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "js", "mjs": return "application/javascript"
        case "wasm": return "application/wasm"
        case "css": return "text/css"
        default: return UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    private func contains(_ root: URL, _ url: URL) -> Bool {
        let base = root.standardizedFileURL.resolvingSymlinksInPath().path
        return url.path == base || url.path.hasPrefix(base + "/")
    }
}

struct FileFailure: Error {
    let code: Int
    init(_ code: Int) { self.code = code }
    static func code(_ error: Error) -> Int {
        if let error = error as? FileFailure { return error.code }
        let error = error as NSError
        switch error.code {
        case NSFileNoSuchFileError, NSFileReadNoSuchFileError: return 1
        case NSFileWriteFileExistsError: return 12
        case NSFileReadNoPermissionError, NSFileWriteNoPermissionError: return 2
        case NSFileWriteOutOfSpaceError: return 10
        default: return 4
        }
    }
}
