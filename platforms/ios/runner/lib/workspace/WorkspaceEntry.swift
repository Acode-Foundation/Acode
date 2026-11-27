import Foundation

struct WorkspaceEntry {
    let root: String
    let parent: String
    let url: String
    let name: String
    let path: String
    let mime: String
    let directory: Bool
    let size: Int64
    let modified: Double
    var values: [Any] { [root, parent, url, name, path, mime, directory ? 1 : 0, size, modified] }
    var json: [String: Any] {
        ["rootUrl": root, "parent": parent, "parentUrl": parent, "url": url, "uri": url,
         "name": name, "path": path, "mime": mime, "type": mime, "isDirectory": directory,
         "isFile": !directory, "size": size, "modifiedDate": modified]
    }

    init(url: URL, root: String, parent: String, parentPath: String) throws {
        let safeURL = try AppFiles.shared.resolve(url.absoluteString)
        let info = try safeURL.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
        self.root = root; self.parent = parent
        self.url = URL(fileURLWithPath: url.path, isDirectory: false).absoluteString
        name = url.lastPathComponent; path = parentPath + "/" + name
        directory = info.isDirectory == true
        let detectedMime = AppFiles.shared.mimeType(url)
        mime = directory ? "vnd.android.document/directory" : (detectedMime == "application/octet-stream" ? "" : detectedMime)
        size = max(0, Int64(info.fileSize ?? 0)); modified = max(0, (info.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000)
    }

    init(_ row: [String: Any], database: Bool = false) {
        root = row[database ? "root_url" : "rootUrl"] as? String ?? ""
        parent = row[database ? "parent_url" : "parentUrl"] as? String ?? row["parent"] as? String ?? ""
        url = row["url"] as? String ?? ""; name = row["name"] as? String ?? ""; path = row["path"] as? String ?? ""
        mime = row["mime"] as? String ?? row["type"] as? String ?? ""
        directory = (row[database ? "is_directory" : "isDirectory"] as? NSNumber)?.boolValue ?? false
        size = max(0, (row["size"] as? NSNumber)?.int64Value ?? 0)
        modified = max(0, (row[database ? "modified_date" : "modifiedDate"] as? NSNumber)?.doubleValue ?? (row["lastModified"] as? NSNumber)?.doubleValue ?? 0)
    }
}
