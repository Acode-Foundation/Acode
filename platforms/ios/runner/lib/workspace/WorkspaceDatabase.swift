import Foundation
import SQLite3

final class WorkspaceDatabase {
    private var connection: OpaquePointer?
    private let lock = NSRecursiveLock()
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL = AppFiles.shared.data.appendingPathComponent("workspace-index.sqlite")) throws {
        guard sqlite3_open_v2(url.path, &connection, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            let error = failure(); sqlite3_close(connection); connection = nil; throw error
        }
        sqlite3_busy_timeout(connection, 5000)
        try execute("PRAGMA journal_mode=WAL")
        try execute("CREATE TABLE IF NOT EXISTS workspaces (root_url TEXT PRIMARY KEY, title TEXT, indexed_at INTEGER)")
        try execute("CREATE TABLE IF NOT EXISTS files (root_url TEXT, parent_url TEXT, url TEXT, name TEXT, path TEXT, mime TEXT, is_directory INTEGER, size INTEGER, modified_date INTEGER, PRIMARY KEY (root_url, url))")
        try execute("CREATE TABLE IF NOT EXISTS content (url TEXT PRIMARY KEY, size INTEGER, modified_date INTEGER, encoding TEXT, text TEXT)")
        try execute("CREATE INDEX IF NOT EXISTS idx_files_parent ON files(root_url, parent_url)")
    }

    deinit { sqlite3_close(connection) }

    @discardableResult
    func execute(_ sql: String, _ values: [Any] = []) throws -> Int {
        lock.lock(); defer { lock.unlock() }
        let statement = try prepare(sql, values)
        defer { sqlite3_finalize(statement) }
        var status = sqlite3_step(statement)
        while status == SQLITE_ROW { status = sqlite3_step(statement) }
        guard status == SQLITE_DONE else { throw failure() }
        return Int(sqlite3_changes(connection))
    }

    func rows(_ sql: String, _ values: [Any] = []) throws -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        let statement = try prepare(sql, values)
        defer { sqlite3_finalize(statement) }
        var result: [[String: Any]] = []
        var status = sqlite3_step(statement)
        while status == SQLITE_ROW {
            var row: [String: Any] = [:]
            for column in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, column))
                switch sqlite3_column_type(statement, column) {
                case SQLITE_INTEGER: row[name] = sqlite3_column_int64(statement, column)
                case SQLITE_FLOAT: row[name] = sqlite3_column_double(statement, column)
                case SQLITE_TEXT:
                    if let bytes = sqlite3_column_text(statement, column) {
                        row[name] = String(decoding: UnsafeBufferPointer(start: bytes, count: Int(sqlite3_column_bytes(statement, column))), as: UTF8.self)
                    }
                default: row[name] = NSNull()
                }
            }
            result.append(row)
            status = sqlite3_step(statement)
        }
        guard status == SQLITE_DONE else { throw failure() }
        return result
    }

    func transaction<T>(_ body: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        try execute("BEGIN IMMEDIATE")
        do {
            let value = try body()
            try execute("COMMIT")
            return value
        } catch { _ = try? execute("ROLLBACK"); throw error }
    }

    func save(_ entry: WorkspaceEntry) throws {
        try execute("INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", entry.values)
    }

    func removeSubtree(root: String, url: String) throws -> Int {
        let condition = "root_url = ? AND (url = ? OR url LIKE ? ESCAPE '\\')"
        let values = [root, url, Self.escapeLike(url.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/") + "%"]
        try execute("DELETE FROM content WHERE url IN (SELECT url FROM files WHERE " + condition + ")", values)
        return try execute("DELETE FROM files WHERE " + condition, values)
    }

    func clear(_ roots: [String]) throws {
        try transaction {
            if roots.isEmpty {
                try execute("DELETE FROM content"); try execute("DELETE FROM files"); try execute("DELETE FROM workspaces")
            } else {
                for root in roots {
                    try execute("DELETE FROM content WHERE url IN (SELECT url FROM files WHERE root_url = ?)", [root])
                    try execute("DELETE FROM files WHERE root_url = ?", [root])
                    try execute("DELETE FROM workspaces WHERE root_url = ?", [root])
                }
            }
        }
    }

    private func prepare(_ sql: String, _ values: [Any]) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(connection, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw failure() }
        do {
            for (offset, value) in values.enumerated() {
                let index = Int32(offset + 1)
                let status: Int32
                if let text = value as? String { status = text.withCString { sqlite3_bind_text(statement, index, $0, Int32(text.utf8.count), transient) } }
                else if let number = value as? NSNumber { status = sqlite3_bind_double(statement, index, number.doubleValue) }
                else { status = sqlite3_bind_null(statement, index) }
                guard status == SQLITE_OK else { throw failure() }
            }
            return statement
        } catch { sqlite3_finalize(statement); throw error }
    }

    private func failure() -> WorkspaceFailure { WorkspaceFailure(String(cString: sqlite3_errmsg(connection))) }

    static func escapeLike(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "%", with: "\\%").replacingOccurrences(of: "_", with: "\\_")
    }
}

struct WorkspaceFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}
