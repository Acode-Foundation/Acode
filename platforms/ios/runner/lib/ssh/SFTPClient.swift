import Foundation
import CSSH2

final class SFTPClient {
    let connection: SSHConnection
    let handle: OpaquePointer
    let profileID: String
    private(set) var directory = ""

    init(connection: SSHConnection, profileID: String) throws {
        self.connection = connection; self.profileID = profileID
        connection.begin()
        handle = try connection.pointer { libssh2_sftp_init(connection.session) }
        var buffer = [CChar](repeating: 0, count: 32768)
        let count = try connection.integer { Int(libssh2_sftp_symlink_ex(handle, ".", 1, &buffer, UInt32(buffer.count), LIBSSH2_SFTP_REALPATH)) }
        guard count > 0 else { throw connection.failure() }
        directory = String(decoding: buffer.prefix(count).map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }

    deinit { connection.cleanup { libssh2_sftp_shutdown(handle) } }

    func path(_ value: String) throws -> String {
        guard !value.contains("\0") else { throw SecretFailure("Invalid remote path") }
        if value.hasPrefix("/") { return value }
        return directory + (directory.hasSuffix("/") ? "" : "/") + value
    }

    func attributes(_ path: String, follow: Bool = false) throws -> LIBSSH2_SFTP_ATTRIBUTES {
        connection.begin()
        var attributes = LIBSSH2_SFTP_ATTRIBUTES()
        let result = try connection.integer { Int(libssh2_sftp_stat_ex(handle, path, UInt32(path.utf8.count), follow ? LIBSSH2_SFTP_STAT : LIBSSH2_SFTP_LSTAT, &attributes)) }
        guard result == 0 else { throw failure() }
        return attributes
    }

    func list(_ path: String) throws -> [[String: Any]] {
        connection.begin()
        let folder = try connection.pointer { libssh2_sftp_open_ex(handle, path, UInt32(path.utf8.count), 0, 0, LIBSSH2_SFTP_OPENDIR) }
        defer { close(folder) }
        var entries: [[String: Any]] = []
        while true {
            connection.begin()
            var buffer = [CChar](repeating: 0, count: 32768), attributes = LIBSSH2_SFTP_ATTRIBUTES()
            let count = try connection.integer { Int(libssh2_sftp_readdir_ex(folder, &buffer, buffer.count, nil, 0, &attributes)) }
            if count == 0 { return entries }
            guard count > 0 else { throw failure() }
            let name = String(decoding: buffer.prefix(count).map { UInt8(bitPattern: $0) }, as: UTF8.self)
            if name == "." || name == ".." { continue }
            let child = path + (path.hasSuffix("/") ? "" : "/") + name
            entries.append(try info(child, attributes: attributes))
        }
    }

    func stat(_ path: String) throws -> [String: Any] {
        do { return try info(path, attributes: attributes(path)) }
        catch let error as SFTPFailure where error.code == LIBSSH2_FX_NO_SUCH_FILE || error.code == LIBSSH2_FX_NO_SUCH_PATH {
            return ["exists": false, "url": path]
        }
    }

    func info(_ path: String, attributes: LIBSSH2_SFTP_ATTRIBUTES) throws -> [String: Any] {
        let mode = attributes.permissions
        let isLink = mode & 0o170000 == 0o120000
        var targetAttributes = attributes
        var result: [String: Any] = ["name": (path as NSString).lastPathComponent, "url": path, "exists": true,
            "canRead": mode & 0o400 != 0, "canWrite": mode & 0o200 != 0, "length": attributes.filesize,
            "lastModified": attributes.mtime, "permissions": permissions(mode), "isLink": isLink]
        if isLink {
            var buffer = [CChar](repeating: 0, count: 32768)
            let count = try connection.integer { Int(libssh2_sftp_symlink_ex(handle, path, UInt32(path.utf8.count), &buffer, UInt32(buffer.count), LIBSSH2_SFTP_READLINK)) }
            if count > 0 {
                result["linkTarget"] = String(decoding: buffer.prefix(count).map { UInt8(bitPattern: $0) }, as: UTF8.self)
            }
            do { targetAttributes = try self.attributes(path, follow: true) }
            catch let error as SFTPFailure where error.code == LIBSSH2_FX_NO_SUCH_FILE || error.code == LIBSSH2_FX_NO_SUCH_PATH {
                result["isFile"] = false; result["isDirectory"] = false; return result
            }
        }
        result["isDirectory"] = targetAttributes.permissions & 0o170000 == 0o040000
        result["isFile"] = targetAttributes.permissions & 0o170000 == 0o100000
        return result
    }

    func mkdir(_ path: String) throws {
        connection.begin()
        try check { libssh2_sftp_mkdir_ex(handle, path, UInt32(path.utf8.count), 0o755) }
    }

    func rename(_ source: String, to destination: String) throws {
        connection.begin()
        try check { libssh2_sftp_rename_ex(handle, source, UInt32(source.utf8.count), destination, UInt32(destination.utf8.count), 0) }
    }

    func remove(_ path: String, force: Bool, recursive: Bool) throws {
        let attributes: LIBSSH2_SFTP_ATTRIBUTES
        do { attributes = try self.attributes(path) }
        catch let error as SFTPFailure where force && (error.code == LIBSSH2_FX_NO_SUCH_FILE || error.code == LIBSSH2_FX_NO_SUCH_PATH) { return }
        if attributes.permissions & 0o170000 == 0o040000 {
            if recursive {
                for entry in try list(path) { try remove(entry["url"] as! String, force: force, recursive: true) }
            }
            connection.begin()
            try check { libssh2_sftp_rmdir_ex(handle, path, UInt32(path.utf8.count)) }
        } else {
            connection.begin()
            try check { libssh2_sftp_unlink_ex(handle, path, UInt32(path.utf8.count)) }
        }
    }

    func open(_ path: String, flags: Int32) throws -> OpaquePointer {
        connection.begin()
        return try connection.pointer { libssh2_sftp_open_ex(handle, path, UInt32(path.utf8.count), UInt(flags), 0o644, LIBSSH2_SFTP_OPENFILE) }
    }

    @discardableResult
    func close(_ file: OpaquePointer) -> Int32 {
        connection.cleanup { libssh2_sftp_close_handle(file) }
    }

    func withFile(_ path: String, flags: Int32, operation: (OpaquePointer) throws -> Void) throws {
        let file = try open(path, flags: flags)
        do { try operation(file) }
        catch { close(file); throw error }
        guard close(file) == 0 else { throw failure() }
    }

    func check(_ operation: () -> Int32) throws {
        if try connection.integer({ Int(operation()) }) < 0 { throw failure() }
    }

    func failure() -> Error {
        if libssh2_session_last_errno(connection.session) == LIBSSH2_ERROR_SFTP_PROTOCOL {
            return SFTPFailure(code: libssh2_sftp_last_error(handle))
        }
        return connection.failure()
    }

    private func permissions(_ mode: UInt) -> String {
        var value = mode & 0o170000 == 0o040000 ? "d" : mode & 0o170000 == 0o120000 ? "l" : "-"
        for shift in [6, 3, 0] {
            value += mode & (4 << shift) != 0 ? "r" : "-"
            value += mode & (2 << shift) != 0 ? "w" : "-"
            value += mode & (1 << shift) != 0 ? "x" : "-"
        }
        return value
    }
}

struct SFTPFailure: LocalizedError {
    let code: UInt
    var errorDescription: String? { [2: "Remote file was not found", 3: "Permission denied", 4: "Remote file operation failed", 11: "File already exists" ][Int(code)] ?? "SFTP error \(code)" }
}
