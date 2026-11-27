import Foundation

struct FileTransfer {
    private static let files = AppFiles.shared

    static func perform(_ source: URL, to destination: URL, moving: Bool = false) throws {
        var coordinationError: NSError?
        var result: Result<Void, Error>?
        let coordinator = NSFileCoordinator()
        let accessor: (URL, URL) -> Void = { input, output in
            result = Result {
                try transfer(input, to: output, moving: moving)
                if moving { coordinator.item(at: input, didMoveTo: output) }
            }
        }
        if moving {
            coordinator.coordinate(writingItemAt: source, options: .forMoving, writingItemAt: destination, options: .forReplacing, error: &coordinationError, byAccessor: accessor)
        } else {
            coordinator.coordinate(readingItemAt: source, options: [], writingItemAt: destination, options: .forReplacing, error: &coordinationError, byAccessor: accessor)
        }
        if let error = coordinationError { throw error }
        guard let result else { throw FileFailure(4) }
        try result.get()
    }

    private static func transfer(_ source: URL, to destination: URL, moving: Bool) throws {
        let sourceInfo = try files.manager.attributesOfItem(atPath: source.path)
        let directory = sourceInfo[.type] as? FileAttributeType == .typeDirectory
        guard source.path != destination.path,
              !directory || !destination.path.hasPrefix(source.path + "/") else { throw FileFailure(9) }
        let roots = files.allRoots().values.map { $0.standardizedFileURL.resolvingSymlinksInPath().path }
        guard !roots.contains(destination.path), !moving || !roots.contains(source.path) else { throw FileFailure(6) }
        let existing: [FileAttributeKey: Any]?
        do { existing = try files.manager.attributesOfItem(atPath: destination.path) }
        catch {
            guard FileFailure.code(error) == 1 else { throw error }
            existing = nil
        }
        if let existing {
            let targetDirectory = existing[.type] as? FileAttributeType == .typeDirectory
            guard directory == targetDirectory else { throw FileFailure(9) }
            if targetDirectory, !(try files.manager.contentsOfDirectory(atPath: destination.path)).isEmpty { throw FileFailure(9) }
        }
        if moving, existing == nil {
            try files.manager.moveItem(at: source, to: destination)
            return
        }
        let temporary = destination.deletingLastPathComponent().appendingPathComponent(".acode-copy-" + UUID().uuidString)
        defer { try? files.manager.removeItem(at: temporary) }
        try files.manager.copyItem(at: source, to: temporary)
        if existing != nil { _ = try files.manager.replaceItemAt(destination, withItemAt: temporary) }
        else { try files.manager.moveItem(at: temporary, to: destination) }
        if moving { try files.manager.removeItem(at: source) }
    }
}
