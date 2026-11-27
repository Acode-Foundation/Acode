import Foundation

struct SystemFiles {
    private static let files = AppFiles.shared

    static func perform(_ action: String, args: [Any]) throws -> Any? {
        let path = args[safe: 0] as? String ?? ""
        if action == "fileExists" {
            let countLinks = (args[safe: 1] as? String)?.lowercased() == "true"
            guard let url = try? files.resolve(path, followingFinalSymlink: !countLinks) else { return 0 }
            let linkExists = countLinks && (try? files.manager.destinationOfSymbolicLink(atPath: url.path)) != nil
            return linkExists || files.manager.fileExists(atPath: url.path) ? 1 : 0
        }
        if action == "createSymlink" { return createSymlink(target: path, path: args[safe: 1] as? String ?? "") }
        if action == "extractAsset" {
            guard !path.isEmpty, !path.hasPrefix("/"), !path.split(separator: "/").contains("..") else { throw FileFailure(5) }
            let source = try files.resolve(files.application.appendingPathComponent(path).absoluteString)
            let destination = try files.resolve(args[safe: 1] as? String ?? "", followingFinalSymlink: false)
            try copy(source, to: destination)
            return nil
        }
        let url = try files.resolve(path, followingFinalSymlink: action != "deleteFile" && action != "getParentPath")
        switch action {
        case "getParentPath": return url.deletingLastPathComponent().path
        case "listChildren":
            return (try? files.coordinate(url) { directory in
                try files.manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).map(\.path)
            }) ?? []
        case "mkdirs":
            try files.coordinate(url, writing: true) { item in
                guard !files.manager.fileExists(atPath: item.path) else { throw SecretFailure("mkdirs failed") }
                try files.manager.createDirectory(at: item, withIntermediateDirectories: true)
            }
        case "writeText":
            guard let content = args[safe: 1] as? String else { throw FileFailure(5) }
            // Android writes a singleton line, including its terminating newline.
            try files.coordinate(url, writing: true) { try (content + "\n").write(to: $0, atomically: true, encoding: .utf8) }
            return "File written successfully"
        case "deleteFile":
            try files.coordinate(url, writing: true) { item in
                guard !files.allRoots().values.contains(where: { $0.standardizedFileURL.resolvingSymlinksInPath() == item }) else { throw FileFailure(6) }
                let info = try files.manager.attributesOfItem(atPath: item.path)
                if info[.type] as? FileAttributeType == .typeDirectory,
                   !(try files.manager.contentsOfDirectory(atPath: item.path)).isEmpty { throw SecretFailure("delete failed") }
                try files.manager.removeItem(at: item)
            }
        case "copyToUri":
            let directory = try files.resolve(args[safe: 1] as? String ?? "")
            let name = args[safe: 2] as? String ?? ""
            guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0") else { throw FileFailure(5) }
            try files.coordinate(directory, writing: true) {
                try files.manager.createDirectory(at: $0, withIntermediateDirectories: true)
            }
            let destination = try files.resolve(directory.appendingPathComponent(name).absoluteString, followingFinalSymlink: false)
            try copy(url, to: destination)
        default: throw FileFailure(9)
        }
        return nil
    }

    private static func createSymlink(target: String, path: String) -> Int {
        do {
            guard !target.isEmpty else { return 0 }
            let link = try files.resolve(path, followingFinalSymlink: false)
            let destination = target.hasPrefix("/") ? target : link.deletingLastPathComponent().appendingPathComponent(target).path
            _ = try files.resolve(destination)
            try files.coordinate(link, writing: true) { try files.manager.createSymbolicLink(atPath: $0.path, withDestinationPath: target) }
            return 1
        } catch { return 0 }
    }

    private static func copy(_ source: URL, to destination: URL) throws {
        guard (try source.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true else { throw FileFailure(9) }
        try FileTransfer.perform(source, to: destination)
    }
}
