import Foundation

final class FileWatch: NSObject, NSFilePresenter {
    let presentedItemURL: URL?
    let presentedItemOperationQueue: OperationQueue
    private let callback: Callback

    init(url: URL, callback: Callback) {
        presentedItemURL = url
        self.callback = callback
        presentedItemOperationQueue = OperationQueue()
        presentedItemOperationQueue.maxConcurrentOperationCount = 1
        super.init()
        NSFileCoordinator.addFilePresenter(self)
    }

    func stop() {
        NSFileCoordinator.removeFilePresenter(self)
        callback.release()
    }

    func presentedItemDidChange() { callback.success(keep: true) }
    func presentedItemDidMove(to newURL: URL) { callback.success(keep: true) }
    func presentedSubitemDidAppear(at url: URL) { callback.success(keep: true) }
    func presentedSubitemDidChange(at url: URL) { callback.success(keep: true) }
    func presentedSubitem(at oldURL: URL, didMoveTo newURL: URL) { callback.success(keep: true) }
    func accommodatePresentedItemDeletion(completionHandler: @escaping (Error?) -> Void) {
        callback.success(keep: true)
        completionHandler(nil)
    }
    func accommodatePresentedSubitemDeletion(at url: URL, completionHandler: @escaping (Error?) -> Void) {
        callback.success(keep: true)
        completionHandler(nil)
    }
}
