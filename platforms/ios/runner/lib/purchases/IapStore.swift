import StoreKit
import UIKit

@MainActor
final class IapStore {
    private var listener: Callback?
    private var updates: Task<Void, Never>?
    private var operations: [UUID: Task<Void, Never>] = [:]
    private var delivered = Set<String>()
    private var purchasing = false

    func exec(action: String, args: [Any], callback: Callback, presenter: UIViewController?) {
        if action == "setPurchaseUpdatedListener" {
            listener?.release(); listener = callback; delivered.removeAll(); listen(); return
        }
        if action == "startConnection" {
            if AppStore.canMakePayments { listen(); callback.success(0) }
            else { callback.error(3) }
            return
        }
        let id = UUID()
        operations[id] = Task { [weak self] in
            guard let self else { return }
            defer { self.operations.removeValue(forKey: id) }
            do {
                switch action {
                case "getProducts":
                    guard let ids = args[safe: 0] as? [String], ids.allSatisfy({ !$0.isEmpty }) else { throw IapFailure(5) }
                    let products = try await Product.products(for: ids).filter { [.consumable, .nonConsumable].contains($0.type) }
                    try Task.checkCancellation()
                    callback.success(products.map(IapPurchase.product))
                case "getPurchases": callback.success(try await purchases().map(\.json))
                case "restorePurchases":
                    try await AppStore.sync()
                    callback.success(try await purchases().map(\.json))
                case "consume", "acknowledgePurchase":
                    guard let token = args[safe: 0] as? String,
                          let reference = IapPurchase.reference(token),
                          let purchase = try await purchases().first(where: {
                              $0.transaction.id == reference.id && $0.transaction.productID == reference.product &&
                              $0.transaction.appBundleID == reference.bundle
                          }) else { throw IapFailure(8) }
                    if action == "consume" && purchase.transaction.productType != .consumable { throw IapFailure(5) }
                    try Task.checkCancellation()
                    await purchase.transaction.finish()
                    callback.success(action == "consume" ? 0 : nil)
                case "purchase": try await purchase(args[safe: 0] as? String, callback: callback, presenter: presenter)
                default: throw IapFailure(5)
                }
            } catch { callback.error(IapFailure.code(error)) }
        }
    }

    func reset() {
        updates?.cancel(); updates = nil
        for operation in operations.values { operation.cancel() }
        operations.removeAll()
        listener?.release(); listener = nil
        delivered.removeAll()
    }

    private func listen() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled else { return }
                self?.receive(result)
            }
        }
    }

    private func purchases() async throws -> [IapPurchase] {
        var found: [UInt64: IapPurchase] = [:]
        for await result in Transaction.currentEntitlements {
            try Task.checkCancellation()
            var purchase = try IapPurchase(result)
            purchase.acknowledged = true
            if purchase.active { found[purchase.transaction.id] = purchase }
        }
        for await result in Transaction.unfinished {
            try Task.checkCancellation()
            let purchase = try IapPurchase(result)
            if purchase.active { found[purchase.transaction.id] = purchase }
        }
        return found.values.sorted { $0.transaction.purchaseDate > $1.transaction.purchaseDate }
    }

    private func purchase(_ productID: String?, callback: Callback, presenter: UIViewController?) async throws {
        guard AppStore.canMakePayments else { throw IapFailure(3) }
        guard !purchasing, let productID, !productID.isEmpty else { throw IapFailure(5) }
        guard let presenter, presenter.view.window?.windowScene?.activationState == .foregroundActive else { throw IapFailure(-1) }
        purchasing = true
        defer { purchasing = false }
        guard let product = try await Product.products(for: [productID]).first,
              [.consumable, .nonConsumable].contains(product.type) else { throw IapFailure(4) }
        if product.type == .nonConsumable, try await purchases().contains(where: { $0.transaction.productID == productID }) { throw IapFailure(7) }
        try Task.checkCancellation()
        listen()
        callback.success()
        // The existing API acknowledges launching the flow separately from its outcome.
        do {
            let result = try await product.purchase(confirmIn: presenter)
            try Task.checkCancellation()
            switch result {
            case .success(let verified): receive(verified)
            case .userCancelled: listener?.error(1, keep: true)
            case .pending: listener?.success([["productIds": [productID], "purchaseState": 2, "isAcknowledged": false, "purchaseToken": "", "store": "appstore"]], keep: true)
            @unknown default: listener?.error(6, keep: true)
            }
        } catch {
            if !Task.isCancelled { listener?.error(IapFailure.code(error), keep: true) }
        }
    }

    private func receive(_ result: VerificationResult<Transaction>) {
        guard let listener else { return }
        do {
            let purchase = try IapPurchase(result)
            let transaction = purchase.transaction
            let key = "\(transaction.id):\(transaction.revocationDate?.timeIntervalSince1970 ?? 0):\(transaction.isUpgraded)"
            guard delivered.insert(key).inserted else { return }
            listener.success([purchase.json], keep: true)
        } catch { listener.error(IapFailure.code(error), keep: true) }
    }

    deinit { updates?.cancel(); for operation in operations.values { operation.cancel() } }
}
