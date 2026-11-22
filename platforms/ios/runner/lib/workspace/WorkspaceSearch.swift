import Foundation

extension WorkspaceIndex {
    func search(_ options: [String: Any], job: WorkspaceJob) throws {
        try job.check()
        let db = try database.get()
        let settings = options["options"] as? [String: Any] ?? [:]
        let replacing = options["mode"] as? String == "replace"
        let search = options["search"] as? String ?? ""
        var pattern = settings["regExp"] as? Bool == true ? search : NSRegularExpression.escapedPattern(for: search)
        if settings["wholeWord"] as? Bool == true { pattern = "\\b" + pattern + "\\b" }
        let flags: NSRegularExpression.Options = settings["caseSensitive"] as? Bool == true ? [.anchorsMatchLines] : [.anchorsMatchLines, .caseInsensitive]
        let regex = try NSRegularExpression(pattern: pattern, options: flags)
        let replacement = WorkspaceReplacement(options["replace"] as? String ?? "", pattern: pattern, regExp: settings["regExp"] as? Bool == true)
        let files = try searchFiles(options)
        let content = WorkspaceContent(database: db)
        let overlays = options["overlays"] as? [String: String] ?? [:]
        let includes = WorkspaceGlob.patterns(settings["include"] as? String)
        let excludes = WorkspaceGlob.patterns(settings["exclude"] as? String)
        var lastProgress = -1
        job.emit("status", ["state": "searching", "message": "Searching files", "progress": 0], false)
        for (offset, file) in files.enumerated() {
            try job.check()
            let progress = offset * 100 / max(1, files.count)
            if progress != lastProgress { job.emit("progress", ["data": progress], false); lastProgress = progress }
            let entry = WorkspaceEntry(file)
            guard entry.url.hasPrefix("file:"), !WorkspaceContent.isBinary(entry) else { continue }
            if !entry.path.isEmpty && (WorkspaceGlob.matches(entry.path, patterns: excludes) || !WorkspaceGlob.matches(entry.path, patterns: includes.isEmpty ? ["**"] : includes)) { continue }
            let text: String
            do {
                guard let value = try content.get(entry, overlays: overlays, encoding: options["defaultEncoding"] as? String ?? "UTF-8", useIndex: options["useIndex"] as? Bool == true, large: !includes.isEmpty && WorkspaceGlob.matches(entry.path, patterns: includes), job: job) else { continue }
                text = value
            } catch { try job.check(); continue }
            let matches = WorkspaceMatches(text: text, regex: regex, job: job)
            if replacing {
                let text = try matches.replace(replacement)
                job.emit("replace-result", ["file": file, "text": text], false)
            } else {
                try matches.search { results, limited in
                    let data: [String: Any] = ["file": file, "matches": results, "limited": limited]
                    let batched = options["batchResults"] as? Bool == true
                    job.emit(batched ? "search-results" : "search-result", ["data": batched ? [data] as Any : data], false)
                }
            }
        }
        try job.check()
        job.emit("progress", ["data": 100], false)
        job.emit(replacing ? "done-replacing" : "done-searching", [:], true)
    }

    private func searchFiles(_ options: [String: Any]) throws -> [[String: Any]] {
        var seen = Set<String>()
        var result = (options["files"] as? [[String: Any]] ?? []).filter {
            guard let url = $0["url"] as? String, !url.isEmpty else { return false }
            return seen.insert(url).inserted
        }
        let roots = options["roots"] as? [String] ?? []
        if !roots.isEmpty {
            var values: [Any] = []
            let condition = rootsClause(roots, values: &values)
            for row in try database.get().rows("SELECT * FROM files WHERE is_directory = 0" + condition, values) {
                let entry = WorkspaceEntry(row, database: true)
                if seen.insert(entry.url).inserted { result.append(entry.json) }
            }
        }
        return result
    }
}
