import Foundation

extension WorkspaceIndex {
    func scan(_ options: [String: Any], job: WorkspaceJob) throws {
        try job.check()
        let root = options["rootUrl"] as? String ?? ""
        let url = try AppFiles.shared.resolve(root)
        guard try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { throw WorkspaceFailure("Workspace is not a directory") }
        let title = options["title"] as? String ?? url.lastPathComponent
        let db = try database.get()
        job.emit("status", ["state": "scanning", "message": "Scanning project files", "progress": 0], false)
        let stats = try db.transaction {
            try db.execute("INSERT OR REPLACE INTO workspaces VALUES (?, ?, ?)", [root, title, Date().timeIntervalSince1970 * 1000])
            try db.execute("DELETE FROM files WHERE root_url = ?", [root])
            let result = try walk(url, root: root, parent: root, path: title, options: options, job: job)
            try job.check()
            return result
        }
        job.emit("done", stats, true)
    }

    func update(_ options: [String: Any]) throws -> [String: Any] {
        let root = options["rootUrl"] as? String ?? ""
        let rootURL = try AppFiles.shared.resolve(root)
        let db = try database.get()
        let savedTitle = try db.rows("SELECT title FROM workspaces WHERE root_url = ?", [root]).first?["title"] as? String
        let title = options["title"] as? String ?? savedTitle ?? rootURL.lastPathComponent
        return try db.transaction {
            var removed = 0, added = 0
            for value in options["removed"] as? [String] ?? [] where !value.isEmpty && value != root {
                let url = try checkedChild(value, root: rootURL)
                removed += try db.removeSubtree(root: root, url: URL(fileURLWithPath: url.path, isDirectory: false).absoluteString)
            }
            for change in options["added"] as? [[String: Any]] ?? [] {
                guard let value = change["url"] as? String, !value.isEmpty, let parent = change["parentUrl"] as? String, !parent.isEmpty else { continue }
                let url = try checkedChild(value, root: rootURL)
                _ = try checkedChild(parent, root: rootURL, allowRoot: true)
                let parentPath = parent == root || (try? AppFiles.shared.resolve(parent))?.path == rootURL.path ? title : (try db.rows("SELECT path FROM files WHERE root_url = ? AND url = ?", [root, parent]).first?["path"] as? String ?? title)
                removed += try db.removeSubtree(root: root, url: URL(fileURLWithPath: url.path, isDirectory: false).absoluteString)
                guard let entry = try? WorkspaceEntry(url: url, root: root, parent: parent, parentPath: parentPath) else { continue }
                if options["showHiddenFiles"] as? Bool != true && entry.name.hasPrefix(".") { continue }
                try db.save(entry); added += 1
                if entry.directory && !WorkspaceGlob.skipsDirectory(entry.path, options: options) {
                    var updatedOptions = options; updatedOptions["indexContent"] = false; updatedOptions["emitEntries"] = false
                    let stats = try walk(url, root: root, parent: entry.url, path: entry.path, options: updatedOptions, job: WorkspaceJob())
                    added += (stats["files"] as? Int ?? 0) + (stats["dirs"] as? Int ?? 0)
                }
            }
            try db.execute("INSERT OR REPLACE INTO workspaces VALUES (?, ?, ?)", [root, title, Date().timeIntervalSince1970 * 1000])
            return ["added": added, "removed": removed]
        }
    }

    private func walk(_ initial: URL, root: String, parent: String, path: String, options: [String: Any], job: WorkspaceJob) throws -> [String: Any] {
        let db = try database.get()
        var stack = [(initial, parent, path)]
        var visited = Set<String>(), batch: [[String: Any]] = []
        let initialPath = initial.resolvingSymlinksInPath()
        var ancestor = initialPath.deletingLastPathComponent()
        while ancestor.path != initialPath.path {
            try job.check()
            guard visited.insert(ancestor.path).inserted, ancestor.path != "/" else { break }
            let parent = ancestor.deletingLastPathComponent()
            guard parent.path.count < ancestor.path.count else { break }
            ancestor = parent
        }
        var files = 0, directories = 0, indexed = 0
        while let (directory, parent, parentPath) = stack.popLast() {
            try job.check()
            guard visited.insert(directory.resolvingSymlinksInPath().path).inserted else { continue }
            guard let children = try? AppFiles.shared.coordinate(directory, { try FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey]) }) else { continue }
            for child in children {
                try job.check()
                if options["showHiddenFiles"] as? Bool != true && child.lastPathComponent.hasPrefix(".") { continue }
                guard let entry = try? WorkspaceEntry(url: child, root: root, parent: parent, parentPath: parentPath) else { continue }
                try db.save(entry)
                if entry.directory { directories += 1 } else { files += 1 }
                if options["emitEntries"] as? Bool != false {
                    batch.append(entry.json)
                    if batch.count == 200 { job.emit("batch", ["entries": batch], false); batch.removeAll(keepingCapacity: true) }
                }
                if entry.directory {
                    if !WorkspaceGlob.skipsDirectory(entry.path, options: options) { stack.append((child, entry.url, entry.path)) }
                } else if options["indexContent"] as? Bool == true {
                    _ = try? WorkspaceContent(database: db).index(entry, encoding: options["defaultEncoding"] as? String ?? "UTF-8", job: job)
                    indexed += 1
                }
            }
        }
        if !batch.isEmpty { job.emit("batch", ["entries": batch], false) }
        return ["files": files, "dirs": directories, "indexed": indexed]
    }

    private func checkedChild(_ value: String, root: URL, allowRoot: Bool = false) throws -> URL {
        let url = try AppFiles.shared.resolve(value)
        guard (allowRoot && root.path == url.path) || url.path.hasPrefix(root.path + "/") else { throw WorkspaceFailure("Entry is outside the workspace") }
        return url
    }
}
