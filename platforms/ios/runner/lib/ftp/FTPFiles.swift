import Foundation

extension FTPClient {
    func entries(_ remote: String) throws -> [FTPEntry] {
        let directory = try path(remote)
        return try perform(directory == "/" ? "/*" : directory + "/*", listing: true).entries
    }

    func list(_ remote: String) throws -> [[String: Any]] {
        let parent = try path(remote)
        return try entries(parent).filter { ![".", ".."].contains($0.name) }.map { entry in
            let child = try path(parent + "/" + entry.name)
            if let link = entry.link {
                let target = try path(link.hasPrefix("/") ? link : parent + "/" + link)
                if let metadata = try? stat(target) { return entry.json(path: target, target: metadata) }
                return entry.json(path: child)
            }
            return entry.json(path: child)
        }
    }

    func stat(_ remote: String) throws -> FTPEntry {
        let target = try path(remote)
        let parent = (target as NSString).deletingLastPathComponent
        if target != "/", let listing = try? entries(parent), let entry = listing.first(where: { $0.name == (target as NSString).lastPathComponent }) { return entry }
        let response = try command("MLST " + target, allowFailure: true)
        if response.hasPrefix("250"), let entry = FTPEntry(facts: response, path: target) { return entry }
        if response.hasPrefix("550") { throw FTPFailure("File not found.", replyCode: 550) }
        if target == "/", let entry = try entries(target).first(where: { $0.name == "." }) { return entry }
        throw FTPFailure("File not found.", replyCode: 550)
    }

    func removeDirectory(_ remote: String, depth: Int = 0) throws {
        guard depth < 128 else { throw FTPFailure("FTP directory nesting is too deep") }
        let parent = try path(remote)
        guard parent != "/" else { throw FTPFailure("Cannot delete the FTP root") }
        for entry in try entries(parent) where ![".", ".."].contains(entry.name) {
            let child = try path(parent + "/" + entry.name)
            if entry.directory && entry.link == nil { try removeDirectory(child, depth: depth + 1) }
            else { try command("DELE " + child) }
        }
        try command("RMD " + parent)
    }

    func rename(_ remote: String, to destination: String) throws {
        try perform(directory + "/", commands: ["RNFR " + path(remote), "RNTO " + path(destination)])
    }

    func download(_ remote: String, to local: String) throws {
        let url = try AppFiles.shared.resolve(local)
        try AppFiles.shared.coordinate(url, writing: true) { url in
            guard FileManager.default.fileExists(atPath: url.path) || FileManager.default.createFile(atPath: url.path, contents: nil) else { throw FileFailure(6) }
            let output = try FileHandle(forWritingTo: url)
            defer { try? output.close() }
            try output.truncate(atOffset: 0)
            let request = FTPRequest(cancellation); request.output = output
            try perform(path(remote), request: request)
        }
    }

    func upload(_ local: String, to remote: String) throws {
        let url = try AppFiles.shared.resolve(local)
        try AppFiles.shared.coordinate(url) { url in
            let input = try FileHandle(forReadingFrom: url)
            defer { try? input.close() }
            let request = FTPRequest(cancellation); request.input = input
            try perform(path(remote), upload: true, request: request)
        }
    }
}
