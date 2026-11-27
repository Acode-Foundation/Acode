import StoreKit

struct IapPurchase {
    let transaction: Transaction
    let signedTransaction: String
    var acknowledged = false

    init(_ result: VerificationResult<Transaction>) throws {
        guard case .verified(let transaction) = result else { throw IapFailure(6) }
        self.transaction = transaction
        signedTransaction = result.jwsRepresentation
    }

    var active: Bool {
        transaction.revocationDate == nil && !transaction.isUpgraded &&
        (transaction.expirationDate.map { $0 > Date() } ?? true) &&
        [.consumable, .nonConsumable].contains(transaction.productType)
    }

    var json: [String: Any] {
        ["productIds": [transaction.productID], "orderId": String(transaction.id),
         "purchaseTime": transaction.purchaseDate.timeIntervalSince1970 * 1000,
         "purchaseToken": signedTransaction, "signature": String(signedTransaction.split(separator: ".").last ?? ""),
         "purchaseState": active ? 1 : 0, "isAcknowledged": acknowledged, "developerPayload": "",
         "store": "appstore", "transactionId": String(transaction.id),
         "originalTransactionId": String(transaction.originalID), "environment": transaction.environment.rawValue,
         "signedTransactionInfo": signedTransaction]
    }

    static func product(_ product: Product) -> [String: Any] {
        ["productId": product.id, "title": product.displayName, "description": product.description,
         "price": product.displayPrice, "priceAmountMicros": NSDecimalNumber(decimal: product.price * 1_000_000).int64Value,
         "priceCurrencyCode": product.priceFormatStyle.currencyCode, "type": "inapp", "store": "appstore"]
    }

    static func reference(_ token: String) -> (id: UInt64, product: String, bundle: String)? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, token.utf8.count <= 32_768 else { return nil }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let bytes = Data(base64Encoded: payload),
              let json = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let rawID = json["transactionId"] as? String, let id = UInt64(rawID),
              let product = json["productId"] as? String, let bundle = json["bundleId"] as? String else { return nil }
        // The token only selects a transaction. Ownership must come from verified StoreKit results.
        // StoreKit can re-sign the same transaction between delivery and acknowledgement.
        return (id, product, bundle)
    }
}

struct IapFailure: Error {
    let code: Int
    init(_ code: Int) { self.code = code }

    static func code(_ error: Error) -> Int {
        if let error = error as? IapFailure { return error.code }
        if error is CancellationError { return -1 }
        if let error = error as? Product.PurchaseError {
            switch error {
            case .productUnavailable: return 4
            case .purchaseNotAllowed: return 3
            default: return 5
            }
        }
        if let error = error as? StoreKitError {
            switch error {
            case .userCancelled: return 1
            case .networkError: return 2
            case .notAvailableInStorefront, .notEntitled: return 3
            case .unsupported: return -2
            default: return 6
            }
        }
        return 6
    }
}
