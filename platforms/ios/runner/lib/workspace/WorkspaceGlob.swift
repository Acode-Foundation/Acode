import Foundation

struct WorkspaceGlob {
    static func skipsDirectory(_ path: String, options: [String: Any]) -> Bool {
        let patterns = options["excludeFolders"] as? [String] ?? []
        return matches(path, patterns: patterns) || matches(path + "/", patterns: patterns)
    }

    static func patterns(_ value: String?) -> [String] {
        (value ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    static func matches(_ path: String, patterns: [String]) -> Bool {
        patterns.contains { matches(path, pattern: $0) }
    }

    private static func matches(_ path: String, pattern: String) -> Bool {
        guard !pattern.isEmpty else { return false }
        if pattern == "**" { return true }
        let path = path.replacingOccurrences(of: "\\", with: "/")
        let characters = Array(pattern.replacingOccurrences(of: "\\", with: "/"))
        var expression = "^", index = 0
        while index < characters.count {
            switch characters[index] {
            case "*":
                if index + 1 < characters.count && characters[index + 1] == "*" {
                    index += 1
                    if index + 1 < characters.count && characters[index + 1] == "/" { expression += "(?:.*/)?"; index += 1 }
                    else { expression += ".*" }
                } else { expression += "[^/]*" }
            case "?": expression += "."
            default: expression += NSRegularExpression.escapedPattern(for: String(characters[index]))
            }
            index += 1
        }
        guard let regex = try? NSRegularExpression(pattern: expression + "$") else { return false }
        return [path, (path as NSString).lastPathComponent].contains { regex.firstMatch(in: $0, range: NSRange(location: 0, length: ($0 as NSString).length)) != nil }
    }
}
