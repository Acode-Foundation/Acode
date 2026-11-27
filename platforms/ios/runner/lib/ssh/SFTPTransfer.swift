import Foundation
import CSSH2

extension SFTPClient {
    func download(_ remote: String, to local: String) throws {
        let url = try AppFiles.shared.resolve(local)
        try AppFiles.shared.coordinate(url, writing: true) { url in
            try withFile(remote, flags: LIBSSH2_FXF_READ) { file in
                guard FileManager.default.fileExists(atPath: url.path) || FileManager.default.createFile(atPath: url.path, contents: nil) else { throw FileFailure(6) }
                let output = try FileHandle(forWritingTo: url)
                defer { try? output.close() }
                try output.truncate(atOffset: 0)
                var buffer = [CChar](repeating: 0, count: 32768)
                while true {
                    connection.begin()
                    let count = try connection.integer { libssh2_sftp_read(file, &buffer, buffer.count) }
                    if count == 0 { break }
                    guard count > 0 else { throw failure() }
                    try buffer.withUnsafeBytes { try output.write(contentsOf: Data($0.prefix(count))) }
                }
            }
        }
    }

    func upload(_ local: String, to remote: String) throws {
        let url = try AppFiles.shared.resolve(local)
        try AppFiles.shared.coordinate(url) { url in
            let input = try FileHandle(forReadingFrom: url)
            defer { try? input.close() }
            try withFile(remote, flags: LIBSSH2_FXF_WRITE | LIBSSH2_FXF_CREAT | LIBSSH2_FXF_TRUNC) { file in
                while let data = try input.read(upToCount: 32768), !data.isEmpty { try write(data, to: file) }
            }
        }
    }

    func create(_ remote: String, contents: String) throws {
        try withFile(remote, flags: LIBSSH2_FXF_WRITE | LIBSSH2_FXF_CREAT | LIBSSH2_FXF_EXCL) { file in
            try write(Data(contents.utf8), to: file)
        }
    }

    private func write(_ data: Data, to file: OpaquePointer) throws {
        try data.withUnsafeBytes { bytes in
            guard let buffer = bytes.bindMemory(to: CChar.self).baseAddress else { return }
            var offset = 0
            while offset < data.count {
                connection.begin()
                let count = try connection.integer { libssh2_sftp_write(file, buffer + offset, min(32768, data.count - offset)) }
                guard count > 0 else { throw failure() }
                offset += count
            }
        }
    }
}
