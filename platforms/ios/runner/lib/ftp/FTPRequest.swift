import Foundation
import AcodeCurl

final class FTPRequest {
    let cancellation: FTPCancellation
    var entries: [FTPEntry] = []
    var replies: [String: String] = [:]
    var replyCodes: [String: Int] = [:]
    var input: FileHandle?
    var output: FileHandle?
    var error: Error?
    private var verb = ""
    private var pending = Data()
    private var response = ""
    private var multiline: String?

    init(_ cancellation: FTPCancellation) { self.cancellation = cancellation }

    func trace(_ type: curl_infotype, bytes: UnsafeMutablePointer<CChar>, count: Int) {
        guard type == CURLINFO_HEADER_IN || type == CURLINFO_HEADER_OUT else { return }
        let text = String(decoding: UnsafeRawBufferPointer(start: bytes, count: count), as: UTF8.self)
        if type == CURLINFO_HEADER_OUT {
            verb = String(text.prefix { !$0.isWhitespace }).uppercased()
            response = ""; multiline = nil
            return
        }
        guard verb != "USER", verb != "PASS" else { return }
        pending.append(UnsafeBufferPointer(start: UnsafeRawPointer(bytes).assumingMemoryBound(to: UInt8.self), count: count))
        guard pending.count + response.utf8.count <= 1_048_576 else { error = FTPFailure("FTP reply is too large"); return }
        while let newline = pending.firstIndex(of: 10) {
            let end = pending.index(after: newline)
            let line = String(decoding: pending[..<end], as: UTF8.self)
            pending.removeSubrange(..<end)
            response += line
            let prefix = String(line.prefix(3))
            if Int(prefix) != nil, line.count >= 4 {
                let marker = line[line.index(line.startIndex, offsetBy: 3)]
                if multiline == nil && marker == "-" { multiline = prefix }
                if marker == " " && (multiline == nil || multiline == prefix) { replies[verb] = response; replyCodes[verb] = Int(prefix); multiline = nil }
            }
        }
    }
}

func ftpRequest(_ pointer: UnsafeMutableRawPointer?) -> FTPRequest {
    Unmanaged<FTPRequest>.fromOpaque(pointer!).takeUnretainedValue()
}

func ftpWrite(_ bytes: UnsafeMutablePointer<CChar>?, _ size: Int, _ count: Int, _ context: UnsafeMutableRawPointer?) -> Int {
    let request = ftpRequest(context)
    do {
        try request.cancellation.check()
        if let output = request.output, let bytes { try output.write(contentsOf: Data(bytes: bytes, count: size * count)) }
        return size * count
    } catch { request.error = error; return 0 }
}

func ftpRead(_ bytes: UnsafeMutablePointer<CChar>?, _ size: Int, _ count: Int, _ context: UnsafeMutableRawPointer?) -> Int {
    let request = ftpRequest(context)
    do {
        try request.cancellation.check()
        guard let input = request.input, let bytes, let data = try input.read(upToCount: min(size * count, 65536)) else { return 0 }
        data.copyBytes(to: UnsafeMutableRawBufferPointer(start: bytes, count: data.count))
        return data.count
    } catch { request.error = error; return Int(CURL_READFUNC_ABORT) }
}
