import Foundation

final class FileService: BaseService {
    private let files = AppFiles.shared

    override func exec(action: String, args: [Any], callback: Callback) {
        do {
            if action == "requestAllPaths" { callback.success(paths()); return }
            if action == "getPathReplacements" { callback.success(files.pathReplacements()); return }
            if action == "requestAllFileSystems" {
                callback.success(try files.allRoots().values.map { try files.entry($0) }); return
            }
            if action == "requestFileSystem" {
                let type = args[safe: 0] as? Int ?? -1
                guard type == 0 || type == 1 else { throw FileFailure(8) }
                let name = type == 0 ? "temporary" : "persistent"
                let root = files.allRoots()[name]!
                let required = args[safe: 1] as? Int ?? 0
                if required > 0 {
                    let attributes = try files.manager.attributesOfFileSystem(forPath: root.path)
                    let available = (attributes[.systemFreeSize] as? NSNumber)?.intValue ?? 0
                    guard required <= available else { throw FileFailure(10) }
                }
                callback.success(["name": name, "root": try files.entry(root)]); return
            }
            guard let path = args[safe: 0] as? String else { throw FileFailure(8) }
            let preserveLink = ["resolveLocalFileSystemURI", "getFileMetadata", "getParent", "remove", "removeRecursively", "moveTo"].contains(action)
            let url = try files.resolve(path, followingFinalSymlink: !preserveLink)
            switch action {
            case "resolveLocalFileSystemURI": callback.success(try files.entry(url))
            case "getFileMetadata": callback.success(try files.coordinate(url) { try files.metadata($0) })
            case "getParent":
                let root = files.allRoots().values.contains { $0.standardizedFileURL.resolvingSymlinksInPath().path == url.path }
                let parent = root ? url : url.deletingLastPathComponent()
                callback.success(try files.entry(files.resolve(parent.absoluteString)))
            case "readEntries":
                callback.success(try files.coordinate(url) { directory in
                    try files.manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]).map { try files.entry($0) }
                })
            case "getFile", "getDirectory":
                callback.success(try child(url, args: args, directory: action == "getDirectory"))
            case "remove", "removeRecursively":
                try files.coordinate(url, writing: true) { item in
                    if action == "remove", (try item.resourceValues(forKeys: [.isDirectoryKey])).isDirectory == true,
                       !(try files.manager.contentsOfDirectory(atPath: item.path)).isEmpty { throw FileFailure(9) }
                    if files.allRoots().values.contains(where: { $0.standardizedFileURL == item.standardizedFileURL }) { throw FileFailure(6) }
                    try files.manager.removeItem(at: item)
                }
                callback.success()
            case "moveTo", "copyTo":
                guard let parent = args[safe: 1] as? String else { throw FileFailure(8) }
                let name = args[safe: 2] as? String ?? url.lastPathComponent
                guard !name.contains(":") else { throw FileFailure(5) }
                let destination = try files.resolve(parent).appendingPathComponent(name)
                let target = try files.resolve(destination.absoluteString, followingFinalSymlink: false)
                if (try? files.manager.attributesOfItem(atPath: target.path)[.type]) as? FileAttributeType == .typeSymbolicLink { throw FileFailure(12) }
                try FileTransfer.perform(url, to: target, moving: action == "moveTo")
                callback.success(try files.entry(target))
            case "setMetadata":
                var item = url
                var values = URLResourceValues()
                if let excluded = (args[safe: 1] as? [String: Any])?["com.apple.MobileBackup"] as? NSNumber { values.isExcludedFromBackup = excluded.boolValue }
                try item.setResourceValues(values)
                callback.success()
            case "write", "truncate", "readAsText", "readAsArrayBuffer", "readAsBinaryString", "readAsDataURL":
                try FileContents.perform(action, url: url, args: args, callback: callback)
            default: callback.error("Unsupported File action: \(action)")
            }
        } catch { callback.error(FileFailure.code(error)) }
    }

    private func child(_ parent: URL, args: [Any], directory: Bool) throws -> [String: Any] {
        guard let name = args[safe: 1] as? String else { throw FileFailure(8) }
        guard !name.contains(":") else { throw FileFailure(5) }
        let options = args[safe: 2] as? [String: Bool] ?? [:]
        let entry = try files.entry(parent)
        guard let filesystem = entry["filesystemName"] as? String,
              let root = files.allRoots()[filesystem],
              let parentPath = entry["fullPath"] as? String else { throw FileFailure(2) }
        let requested = name.hasPrefix("/") ? name : parentPath + "/" + name
        var components: [Substring] = []
        for component in requested.split(separator: "/") {
            if component == ".." { if !components.isEmpty { components.removeLast() } }
            else if component != "." { components.append(component) }
        }
        let path = root.appendingPathComponent(components.joined(separator: "/"))
        let url = try files.resolve(path.absoluteString)
        return try files.coordinate(url, writing: options["create"] == true) { url in
            var isDirectory: ObjCBool = false
            let exists = files.manager.fileExists(atPath: url.path, isDirectory: &isDirectory)
            if exists {
                if options["create"] == true, options["exclusive"] == true { throw FileFailure(12) }
                if isDirectory.boolValue != directory { throw FileFailure(11) }
            } else {
                guard options["create"] == true else { throw FileFailure(1) }
                if directory { try files.manager.createDirectory(at: url, withIntermediateDirectories: false) }
                else if !files.manager.createFile(atPath: url.path, contents: Data()) { throw FileFailure(6) }
            }
            return try files.entry(path)
        }
    }

    private func paths() -> [String: Any] {
        ["applicationDirectory": directoryURL(files.application),
         "applicationStorageDirectory": directoryURL(URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)),
         "dataDirectory": directoryURL(files.data),
         "cacheDirectory": directoryURL(files.cache),
         "tempDirectory": directoryURL(files.temporary),
         "documentsDirectory": directoryURL(files.documents),
         "syncedDataDirectory": NSNull(), "sharedDirectory": NSNull(),
         "externalApplicationStorageDirectory": NSNull(), "externalDataDirectory": NSNull(),
         "externalCacheDirectory": NSNull(), "externalRootDirectory": NSNull()]
    }

    // FileManager directory URLs already end in "/"; entries resolve to single-slash URLs, so the
    // roots must too or JS prefix checks against them never match.
    private func directoryURL(_ url: URL) -> String {
        let string = url.absoluteString
        return string.hasSuffix("/") ? string : string + "/"
    }
}
