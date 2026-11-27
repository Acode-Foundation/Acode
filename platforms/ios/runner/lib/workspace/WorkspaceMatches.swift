import Foundation

final class WorkspaceMatches {
    let text: String
    let source: NSString
    let regex: NSRegularExpression
    let job: WorkspaceJob
    private var deadline = ProcessInfo.processInfo.systemUptime + 2

    init(text: String, regex: NSRegularExpression, job: WorkspaceJob) {
        self.text = text; source = text as NSString; self.regex = regex; self.job = job
    }

    func search(_ emit: ([[String: Any]], Bool) -> Void) throws {
        var batch: [[String: Any]] = []
        var count = 0, cursor = 0, row = 0, column = 0
        try enumerate { match in
            let range = match.range
            if count == 5000 { emit(batch, true); batch.removeAll(); return false }
            let word = self.source.substring(with: NSRange(location: range.location, length: min(160, range.length)))
            try self.advance(to: range.location, cursor: &cursor, row: &row, column: &column)
            let start = ["row": row, "column": column]
            try self.advance(to: NSMaxRange(range), cursor: &cursor, row: &row, column: &column)
            batch.append(["match": word, "renderText": self.render(word), "line": self.surrounding(range), "position": ["start": start, "end": ["row": row, "column": column]]])
            count += 1
            if batch.count == 200 && count < 5000 { emit(batch, false); batch.removeAll(keepingCapacity: true); self.renew() }
            return true
        }
        if !batch.isEmpty { emit(batch, false) }
    }

    func replace(_ replacement: WorkspaceReplacement) throws -> String {
        let result = NSMutableString(capacity: source.length)
        var cursor = 0
        try enumerate { match in
            result.append(self.source.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
            result.append(replacement.expand(match, in: self.source))
            cursor = NSMaxRange(match.range)
            return true
        }
        result.append(source.substring(from: cursor))
        return result as String
    }

    private func enumerate(_ match: (NSTextCheckingResult) throws -> Bool) throws {
        var failure: Error?
        regex.enumerateMatches(in: text, options: [.reportProgress], range: NSRange(location: 0, length: source.length)) { result, flags, stop in
            do {
                try self.check()
                if let result, try !match(result) { stop.pointee = true }
                if flags.contains(.internalError) { throw WorkspaceFailure("Regular expression failed") }
            } catch { failure = error; stop.pointee = true }
        }
        if let failure { throw failure }
        try job.check()
    }

    private func advance(to position: Int, cursor: inout Int, row: inout Int, column: inout Int) throws {
        while cursor < position {
            if cursor & 1023 == 0 { try check() }
            if source.character(at: cursor) == 10 { row += 1; column = 0 } else { column += 1 }
            cursor += 1
        }
    }

    private func surrounding(_ range: NSRange) -> String {
        let remaining = max(0, 160 - range.length)
        var start = range.location, end = min(NSMaxRange(range), range.location + 160)
        let left = max(0, start - remaining / 2)
        while start > left && ![10, 13].contains(source.character(at: start - 1)) { start -= 1 }
        let right = min(source.length, start + 160)
        while end < right && ![10, 13].contains(source.character(at: end)) { end += 1 }
        var line = source.substring(with: NSRange(location: start, length: end - start)).trimmingCharacters(in: .whitespacesAndNewlines)
        if start > 0 && ![10, 13].contains(source.character(at: start - 1)) { line = "..." + line }
        if end < source.length && ![10, 13].contains(source.character(at: end)) { line += "..." }
        return render(line)
    }

    private func render(_ value: String) -> String { value.replacingOccurrences(of: "[\\r\\n]+", with: " ⏎ ", options: .regularExpression) }
    private func check() throws {
        try job.check()
        guard ProcessInfo.processInfo.systemUptime <= deadline else { throw WorkspaceFailure("Search timed out; simplify the expression") }
    }

    private func renew() { deadline = ProcessInfo.processInfo.systemUptime + 2 }
}
