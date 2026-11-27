import UIKit

final class ShareService: BaseService {
    private weak var sheet: UIActivityViewController?
    private var exportDirectory: URL?
    private var pendingCallback: Callback?

    override func reset() {
        DispatchQueue.main.async { [weak self] in
            let sheet = self?.sheet
            self?.finish(error: "Operation cancelled")
            sheet?.dismiss(animated: false)
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        do {
            let item: Any
            var cleanup: URL?
            if action == "shareText" {
                item = args[safe: 0] as? String ?? ""
            } else {
                let source = try AppFiles.shared.resolve(args[safe: 0] as? String ?? "")
                let requestedName = args[safe: 1] as? String ?? ""
                let name = requestedName.isEmpty ? source.lastPathComponent : URL(fileURLWithPath: requestedName).lastPathComponent
                guard !name.isEmpty, name != ".", name != ".." else { throw FileFailure(5) }
                let directory = AppFiles.shared.temporary.appendingPathComponent("share-" + UUID().uuidString)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
                cleanup = directory
                let target = directory.appendingPathComponent(name)
                do { try AppFiles.shared.coordinate(source) { try FileManager.default.copyItem(at: $0, to: target) } }
                catch { try? FileManager.default.removeItem(at: directory); throw error }
                item = target
            }
            DispatchQueue.main.async { [weak self] in
                guard let self, let presenter = self.viewController, presenter.presentedViewController == nil,
                      presenter.viewIfLoaded?.window != nil, self.pendingCallback == nil else {
                    if let cleanup { try? FileManager.default.removeItem(at: cleanup) }
                    callback.error("A share sheet cannot be presented right now"); return
                }
                let sheet = UIActivityViewController(activityItems: [item], applicationActivities: nil)
                if let popover = sheet.popoverPresentationController {
                    popover.sourceView = presenter.view
                    popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                    popover.permittedArrowDirections = []
                }
                self.sheet = sheet
                self.exportDirectory = cleanup
                self.pendingCallback = callback
                sheet.completionWithItemsHandler = { [weak self, weak sheet] _, _, _, error in
                    guard let self, let sheet, self.sheet === sheet else { return }
                    self.finish(error: error?.localizedDescription)
                }
                presenter.present(sheet, animated: true)
            }
        } catch { callback.error(error.localizedDescription) }
    }

    private func finish(error: String?) {
        let callback = pendingCallback
        pendingCallback = nil
        sheet?.completionWithItemsHandler = nil
        sheet = nil
        if let exportDirectory { try? FileManager.default.removeItem(at: exportDirectory) }
        exportDirectory = nil
        if let error { callback?.error(error) }
        else { callback?.success() }
    }
}
