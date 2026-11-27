import UIKit
import UniformTypeIdentifiers

final class DocumentsService: BaseService, UIDocumentPickerDelegate {
    private let files = AppFiles.shared
    private let workspace = WorkspaceIndex()
    private var pickerCallback: Callback?
    private var pickerReturnsURI = false
    private weak var picker: UIDocumentPickerViewController?
    private var watches: [String: FileWatch] = [:]

    override func reset() {
        workspace.reset()
        watches.values.forEach { $0.stop() }
        watches.removeAll()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.pickerCallback?.error("Operation cancelled")
            self.pickerCallback = nil
            self.picker?.delegate = nil
            self.picker?.dismiss(animated: false)
            self.picker = nil
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        if action.hasPrefix("workspace ") { workspace.exec(action, args: args, callback: callback); return }
        do {
            switch action {
            case "watch file":
                let url = try files.resolve(args[safe: 0] as? String ?? "")
                let id = args[safe: 1] as? String ?? ""
                guard files.manager.fileExists(atPath: url.path), !id.isEmpty else { throw FileFailure(1) }
                watches.removeValue(forKey: id)?.stop()
                watches[id] = FileWatch(url: url, callback: callback)
            case "unwatch file":
                watches.removeValue(forKey: args[safe: 0] as? String ?? "")?.stop()
                callback.success()
            case "list volumes":
                callback.success([["name": "Acode", "uuid": "ios-documents", "path": files.documents.path]])
            case "storage permission":
                if args[safe: 0] as? String == "ios-documents" { callback.success("file://" + files.documents.path) }
                else { pick(type: .folder, uriOnly: true, callback: callback) }
            case "open document file", "get image":
                let type = (args[safe: 0] as? String).flatMap { UTType(mimeType: $0) } ?? (action == "get image" ? .image : .item)
                pick(type: type, uriOnly: action == "get image", callback: callback)
            case "list encodings": callback.success(FileContents.availableEncodings())
            default: try operate(action, args: args, callback: callback)
            }
        } catch { callback.error(["code": FileFailure.code(error), "message": error.localizedDescription]) }
    }

    private func operate(_ action: String, args: [Any], callback: Callback) throws {
        let url = try files.resolve(args[safe: 0] as? String ?? "")
        switch action {
        case "stats": callback.success(try stats(url))
        case "exists": callback.success(files.manager.fileExists(atPath: url.path) ? "TRUE" : "FALSE")
        case "format uri": callback.success(url.absoluteString)
        case "get path": callback.success(try files.resolve(url.appendingPathComponent(args[safe: 1] as? String ?? "").absoluteString).path)
        case "list directory":
            callback.success(try files.coordinate(url) { try files.manager.contentsOfDirectory(at: $0, includingPropertiesForKeys: [.isDirectoryKey]).map { try stats($0) } })
        case "read": callback.successBinary(try files.coordinate(url) { try Data(contentsOf: $0) })
        case "readAsText":
            callback.success(try files.coordinate(url) { try String(contentsOf: $0, encoding: FileContents.encoding(args[safe: 1] as? String ?? "UTF-8")) })
        case "write", "writeText":
            let data: Data
            if action == "write", args[safe: 2] as? Bool == true {
                guard let bytes = Data(base64Encoded: args[safe: 1] as? String ?? "") else { throw FileFailure(5) }
                data = bytes
            } else {
                let encoding = try FileContents.encoding(action == "writeText" ? args[safe: 2] as? String ?? "UTF-8" : "UTF-8")
                guard let bytes = (args[safe: 1] as? String ?? "").data(using: encoding) else { throw FileFailure(5) }
                data = bytes
            }
            try files.coordinate(url, writing: true) { try data.write(to: $0, options: .atomic) }
            callback.success("OK")
        case "create file", "create directory":
            let target = try files.resolve(url.appendingPathComponent(args[safe: 1] as? String ?? "").absoluteString)
            if files.manager.fileExists(atPath: target.path) { throw FileFailure(12) }
            if action == "create directory" { try files.manager.createDirectory(at: target, withIntermediateDirectories: false) }
            else { try Data().write(to: target, options: .withoutOverwriting) }
            callback.success(target.absoluteString)
        case "delete": try files.coordinate(url, writing: true) { try files.manager.removeItem(at: $0) }; callback.success("OK")
        case "rename", "move", "copy":
            let path = args[safe: 1] as? String ?? ""
            let target = try files.resolve(action == "rename" ? url.deletingLastPathComponent().appendingPathComponent(path).absoluteString : path)
            try files.coordinate(target, writing: true) { target in
                if action == "copy" { try files.manager.copyItem(at: url, to: target) }
                else { try files.manager.moveItem(at: url, to: target) }
            }
            callback.success(target.absoluteString)
        default: callback.error("Unsupported Files action: \(action)")
        }
    }

    private func stats(_ url: URL) throws -> [String: Any] {
        var result = try files.metadata(url)
        result["uri"] = "file://" + url.path
        result["filename"] = url.lastPathComponent
        result["length"] = result["size"]
        result["lastModified"] = result["lastModifiedDate"]
        result["mime"] = result["type"]
        result["exists"] = true
        result["isVirtual"] = false
        result["persistedUriPermission"] = true
        return result
    }

    private func pick(type: UTType, uriOnly: Bool, callback: Callback) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.viewController else { callback.error("View unavailable"); return }
            guard self.pickerCallback == nil else { callback.error("A document picker is already open"); return }
            guard presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else {
                callback.error("A document picker cannot be presented right now"); return
            }
            self.pickerCallback = callback
            self.pickerReturnsURI = uriOnly
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [type], asCopy: false)
            picker.delegate = self
            self.picker = picker
            presenter.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard controller === picker else { return }
        let callback = pickerCallback
        pickerCallback = nil
        picker = nil
        guard let url = urls.first else { callback?.error("No file selected"); return }
        do {
            try files.remember(url)
            callback?.success(pickerReturnsURI ? "file://" + url.path : try stats(url))
        } catch {
            callback?.error(["code": FileFailure.code(error), "message": error.localizedDescription])
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard controller === picker else { return }
        pickerCallback?.error("Operation cancelled")
        pickerCallback = nil
        picker = nil
    }
}
