import Foundation
import UIKit

final class FileHandlerService: BaseService {

    private let homeURL      = URL(fileURLWithPath: NSHomeDirectory())
    private let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    private let cachesURL    = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]

    /// Mirrors Android's `resolvePath`: prepends the app's Documents directory to paths
    /// that start with "/" but are not already absolute sandbox paths.
    private func resolvePath(_ path: String) -> String {
        let home = homeURL.path
        let docs = documentsURL.path
        if path.hasPrefix(home) { return path }
        return path.hasPrefix("/") ? docs + path : docs + "/" + path
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        switch action {
        case "read":            read(args: args, callback: callback)
        case "write":           write(args: args, callback: callback)
        case "delete":          delete(args: args, callback: callback)
        case "move":            move(args: args, callback: callback)
        case "copy":            copy(args: args, callback: callback)
        case "list":            list(args: args, callback: callback)
        case "exists":          exists(args: args, callback: callback)
        case "isDirectory":     isDirectory(args: args, callback: callback)
        case "isFile":          isFile(args: args, callback: callback)
        case "createDirectory": createDirectory(args: args, callback: callback)
        case "createFile":      createFile(args: args, callback: callback)
        case "getMetadata":     getMetadata(args: args, callback: callback)
        case "resolve":         resolve(args: args, callback: callback)
        case "toUrl":           toUrl(args: args, callback: callback)
        case "saveToDevice":    saveToDevice(args: args, callback: callback)
        case "download":        download(args: args, callback: callback)
        case "reveal":          callback.error("reveal is not supported on iOS")
        case "print":           printFile(args: args, callback: callback)
        default:                callback.error("Unknown action: \(action)")
        }
    }

    // MARK: - read

    private func read(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let path = resolvePath(rawPath)
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            callback.success(data.base64EncodedString())
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    // MARK: - write

    private func write(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String,
              let content = args[safe: 1] as? String else { callback.error("path and content required"); return }
        let path = resolvePath(rawPath)
        let isBase64 = (args[safe: 2] as? Bool) == true || (args[safe: 2] as? Int) == 1
        let url = URL(fileURLWithPath: path)
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if isBase64, let data = Data(base64Encoded: content) {
                try data.write(to: url)
            } else {
                try content.write(to: url, atomically: true, encoding: .utf8)
            }
            callback.success()
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    // MARK: - delete

    private func delete(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let path = resolvePath(rawPath)
        do {
            try FileManager.default.removeItem(atPath: path)
            callback.success()
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    // MARK: - move / copy

    private func move(args: [Any], callback: Callback) {
        guard let rawFrom = args[safe: 0] as? String,
              let rawTo   = args[safe: 1] as? String else { callback.error("from and to required"); return }
        let from = resolvePath(rawFrom)
        let to   = resolvePath(rawTo)
        do {
            let dest = URL(fileURLWithPath: to)
            try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.moveItem(atPath: from, toPath: to)
            callback.success()
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    private func copy(args: [Any], callback: Callback) {
        guard let rawFrom = args[safe: 0] as? String,
              let rawTo   = args[safe: 1] as? String else { callback.error("from and to required"); return }
        let from = resolvePath(rawFrom)
        let to   = resolvePath(rawTo)
        do {
            let dest = URL(fileURLWithPath: to)
            try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.copyItem(atPath: from, toPath: to)
            callback.success()
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    // MARK: - list

    private func list(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let path = resolvePath(rawPath)
        do {
            let entries = try FileManager.default.contentsOfDirectory(atPath: path)
            callback.success(entries)
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    // MARK: - exists / isDirectory / isFile

    private func exists(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        callback.success(FileManager.default.fileExists(atPath: resolvePath(rawPath)) ? 1 : 0)
    }

    private func isDirectory(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: resolvePath(rawPath), isDirectory: &isDir)
        callback.success(exists && isDir.boolValue ? 1 : 0)
    }

    private func isFile(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: resolvePath(rawPath), isDirectory: &isDir)
        callback.success(exists && !isDir.boolValue ? 1 : 0)
    }

    // MARK: - createDirectory / createFile

    private func createDirectory(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let resolved = resolvePath(rawPath)
        do {
            try FileManager.default.createDirectory(atPath: resolved, withIntermediateDirectories: true)
            callback.success()
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    private func createFile(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let url = URL(fileURLWithPath: resolvePath(rawPath))
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: url.path, contents: nil)
            callback.success()
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    // MARK: - getMetadata

    private func getMetadata(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let path = resolvePath(rawPath)
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: path)
            var isDir: ObjCBool = false
            FileManager.default.fileExists(atPath: path, isDirectory: &isDir)
            let result: [String: Any] = [
                "name":          URL(fileURLWithPath: path).lastPathComponent,
                "path":          path,
                "size":          (attrs[.size] as? Int) ?? 0,
                "lastModified":  Int((attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000,
                "isDirectory":   isDir.boolValue,
            ]
            callback.success(result)
        } catch {
            callback.error(error.localizedDescription)
        }
    }

    // MARK: - resolve

    private func resolve(args: [Any], callback: Callback) {
        guard let path = args[safe: 0] as? String else { callback.error("path required"); return }
        callback.success(resolvePath(path))
    }

    // MARK: - toUrl

    private func toUrl(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let path       = resolvePath(rawPath)
        let homePath   = homeURL.path
        let docsPath   = documentsURL.path
        let cachesPath = cachesURL.path
        if path.hasPrefix(docsPath) {
            let rel = String(path.dropFirst(docsPath.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            callback.success("acode://localhost/__file__/\(rel)")
        } else if path.hasPrefix(cachesPath) {
            let rel = String(path.dropFirst(cachesPath.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            callback.success("acode://localhost/__cache__/\(rel)")
        } else if path.hasPrefix(homePath) {
            // Any other sandbox path — serve via __file__ relative to home
            let rel = String(path.dropFirst(homePath.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            callback.success("acode://localhost/__file__/\(rel)")
        } else {
            callback.error("Path must be within the app sandbox")
        }
    }

    // MARK: - saveToDevice

    private func saveToDevice(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let resolvedPath = resolvePath(rawPath)
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.viewController else { return }
            let url = URL(fileURLWithPath: resolvedPath)
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = SaveToDeviceDelegate.shared
            SaveToDeviceDelegate.shared.pendingCallback = callback
            vc.present(picker, animated: true)
        }
    }

    // MARK: - download

    private func download(args: [Any], callback: Callback) {
        guard let urlString = args[safe: 0] as? String,
              let rawDest  = args[safe: 1] as? String,
              let url      = URL(string: urlString) else {
            callback.error("url and path required"); return
        }
        let destPath = resolvePath(rawDest)
        let openAfter = (args[safe: 2] as? Bool) == true || (args[safe: 2] as? Int) == 1
        let delegate = DownloadDelegate(destPath: destPath, openAfter: openAfter, callback: callback)
        delegate.start(url: url)
        // Hold reference until done via the delegate's own retention
    }

    // MARK: - print

    private func printFile(args: [Any], callback: Callback) {
        guard let rawPath = args[safe: 0] as? String else { callback.error("path required"); return }
        let path = resolvePath(rawPath)
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.viewController else { return }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo.printInfo()
            info.outputType = .general
            controller.printInfo = info
            controller.printingItem = URL(fileURLWithPath: path)
            controller.present(from: vc.view.frame, in: vc.view, animated: true) { _, completed, error in
                if let error = error { callback.error(error.localizedDescription) }
                else { callback.success(completed ? 1 : 0) }
            }
        }
    }
}

// MARK: - Download helper

private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
    private let destPath: String
    private let openAfter: Bool
    private let callback: Callback
    private var session: URLSession?

    init(destPath: String, openAfter: Bool, callback: Callback) {
        self.destPath = destPath
        self.openAfter = openAfter
        self.callback = callback
    }

    func start(url: URL) {
        let config = URLSessionConfiguration.default
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        session?.downloadTask(with: url).resume()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        callback.success(["progress": progress], keep: true)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let dest = URL(fileURLWithPath: destPath)
        do {
            try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: dest.path) {
                try FileManager.default.removeItem(at: dest)
            }
            try FileManager.default.moveItem(at: location, to: dest)
            callback.success(destPath, keep: false)
        } catch {
            callback.error(error.localizedDescription)
        }
        self.session = nil
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            callback.error(error.localizedDescription)
            self.session = nil
        }
    }
}

// MARK: - saveToDevice delegate

private final class SaveToDeviceDelegate: NSObject, UIDocumentPickerDelegate {
    static let shared = SaveToDeviceDelegate()
    var pendingCallback: Callback?

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        pendingCallback?.success(urls.first?.path)
        pendingCallback = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCallback?.error("Cancelled")
        pendingCallback = nil
    }
}
