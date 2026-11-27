import StoreKit

final class IapService: BaseService {
    private var store: IapStore?

    override func exec(action: String, args: [Any], callback: Callback) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { callback.error(-1); return }
            if self.store == nil { self.store = IapStore() }
            self.store?.exec(action: action, args: args, callback: callback, presenter: self.viewController)
        }
    }

    override func reset() {
        DispatchQueue.main.async { [weak self] in self?.store?.reset(); self?.store = nil }
    }
}
