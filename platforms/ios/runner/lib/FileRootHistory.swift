import Foundation

final class FileRootHistory {
    private let defaults: UserDefaults
    private let key = "acode.fileRootHistory"
    private var paths: [String: String]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        paths = defaults.dictionary(forKey: key) as? [String: String] ?? [:]
    }

    func update(_ roots: [String: URL]) {
        var changed = false
        for (name, root) in roots {
            for path in [root.standardizedFileURL.path, root.standardizedFileURL.resolvingSymlinksInPath().path] {
                if paths[path] != name { paths[path] = name; changed = true }
            }
        }
        if changed { defaults.set(paths, forKey: key) }
    }

    func resolve(_ url: URL, roots: [String: URL]) -> URL {
        let normalized = url.standardizedFileURL
        let path = normalized.path
        if roots.values.contains(where: { contains($0.standardizedFileURL.path, path) }) { return normalized }
        for (previous, name) in paths.sorted(by: { $0.key.count > $1.key.count }) {
            guard let root = roots[name], contains(previous, path) else { continue }
            let relative = String(path.dropFirst(previous.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            return relative.isEmpty ? root : root.appendingPathComponent(relative)
        }
        return normalized
    }

    func replacements(roots: [String: URL]) -> [[String: String]] {
        var replacements: [String: String] = [:]
        for (previous, name) in paths {
            guard let root = roots[name] else { continue }
            if roots.values.contains(where: { contains($0.standardizedFileURL.path, previous) }) { continue }
            let current = root.standardizedFileURL
            let old = URL(fileURLWithPath: previous, isDirectory: false)
            if previous != current.path {
                replacements[old.absoluteString] = URL(fileURLWithPath: current.path, isDirectory: false).absoluteString
                replacements["file://" + previous] = "file://" + current.path
            }
        }
        return replacements.sorted(by: { $0.key.count > $1.key.count }).map { ["from": $0.key, "to": $0.value] }
    }

    private func contains(_ root: String, _ path: String) -> Bool {
        path == root || path.hasPrefix(root + "/")
    }
}
