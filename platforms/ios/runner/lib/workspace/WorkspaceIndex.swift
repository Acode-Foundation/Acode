import Foundation

final class WorkspaceIndex {
    let database: Result<WorkspaceDatabase, Error>
    private let control = DispatchQueue(label: "app.acode.workspace.control")
    private let indexing = DispatchQueue(label: "app.acode.workspace.index", qos: .userInitiated)
    private let searching: OperationQueue = {
        let queue = OperationQueue(); queue.name = "app.acode.workspace.search"; queue.maxConcurrentOperationCount = 2; return queue
    }()
    private var jobs: [String: WorkspaceJob] = [:]

    init(database: Result<WorkspaceDatabase, Error>? = nil) {
        self.database = database ?? Result { try WorkspaceDatabase() }
    }

    func reset() {
        control.async { self.jobs.values.forEach { $0.cancel() }; self.jobs.removeAll() }
    }

    func exec(_ action: String, args: [Any], callback: Callback) {
        control.async {
            let options = args[safe: 0] as? [String: Any] ?? [:]
            switch action {
            case "workspace cancel":
                self.jobs[args[safe: 0] as? String ?? ""]?.cancel(); callback.success("OK")
            case "workspace scan", "workspace search":
                let id = options["id"] as? String ?? UUID().uuidString
                let job = WorkspaceJob(id: id) { type, payload, terminal in
                    callback.success(payload.merging(["id": id, "type": type, "action": type]) { _, value in value }, keep: !terminal)
                }
                self.jobs.removeValue(forKey: id)?.cancel(); self.jobs[id] = job
                let work = {
                    defer { self.control.async { if self.jobs[id] === job { self.jobs.removeValue(forKey: id) } } }
                    do {
                        if action == "workspace scan" { try self.scan(options, job: job) }
                        else { try self.search(options, job: job) }
                    } catch {
                        if job.cancelled && action == "workspace scan" { job.emit("cancelled", [:], true) }
                        else { job.emit("error", ["error": error.localizedDescription], true) }
                    }
                }
                if action == "workspace scan" { self.indexing.async(execute: work) }
                else { self.searching.addOperation(work) }
            default:
                let work = {
                    do {
                        let db = try self.database.get()
                        switch action {
                        case "workspace query": callback.success(try self.query(options))
                        case "workspace update": callback.success(try self.update(options))
                        case "workspace mark dirty":
                            for url in args[safe: 0] as? [String] ?? [] { try db.execute("DELETE FROM content WHERE url = ?", [url]) }
                            callback.success("OK")
                        case "workspace clear": try db.clear(args[safe: 0] as? [String] ?? []); callback.success("OK")
                        default: throw WorkspaceFailure("Unknown workspace action: " + action)
                        }
                    } catch { callback.error(error.localizedDescription) }
                }
                if action == "workspace query" { self.searching.addOperation(work) }
                else { self.indexing.async(execute: work) }
            }
        }
    }

    func query(_ options: [String: Any]) throws -> [String: Any] {
        var values: [Any] = []
        var condition = "1 = 1" + rootsClause(options["roots"] as? [String] ?? [], values: &values)
        if let url = options["url"] as? String, !url.isEmpty { condition += " AND url = ?"; values.append(url) }
        if options["includeDirectories"] as? Bool != true { condition += " AND is_directory = 0" }
        let text = (options["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var order = "name COLLATE NOCASE, path COLLATE NOCASE"
        if !text.isEmpty {
            condition += " AND (name LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')"
            values += Array(repeating: "%" + WorkspaceDatabase.escapeLike(text) + "%", count: 2)
            order = "CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, " + order
            values.append(WorkspaceDatabase.escapeLike(text) + "%")
        }
        let limit = max(1, min(1000, options["limit"] as? Int ?? 200))
        let cursor = max(0, options["cursor"] as? Int ?? options["offset"] as? Int ?? 0)
        let rows = try database.get().rows("SELECT * FROM files WHERE " + condition + " ORDER BY " + order + " LIMIT ? OFFSET ?", values + [limit + 1, cursor])
        return ["entries": rows.prefix(limit).map { WorkspaceEntry($0, database: true).json }, "hasMore": rows.count > limit, "cursor": rows.count > limit ? cursor + limit as Any : NSNull()]
    }

    func rootsClause(_ roots: [String], values: inout [Any]) -> String {
        guard !roots.isEmpty else { return "" }
        let nonempty = roots.filter { !$0.isEmpty }
        guard !nonempty.isEmpty else { return " AND 0 = 1" }
        values += nonempty
        return " AND root_url IN (" + Array(repeating: "?", count: nonempty.count).joined(separator: ",") + ")"
    }
}

final class WorkspaceJob {
    let id: String
    let emit: (String, [String: Any], Bool) -> Void
    private let lock = NSLock()
    private var stopped = false
    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
    init(id: String = UUID().uuidString, emit: @escaping (String, [String: Any], Bool) -> Void = { _, _, _ in }) { self.id = id; self.emit = emit }
    func cancel() { lock.lock(); stopped = true; lock.unlock() }
    func check() throws { if cancelled { throw WorkspaceFailure("Search cancelled") } }
}
