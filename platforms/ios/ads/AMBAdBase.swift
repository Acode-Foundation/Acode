import GoogleMobileAds
import UIKit

class AMBAdBase: NSObject {
    weak var plugin: AMBPlugin?
    let id: String
    private let configuredAdUnitId: String
    var adUnitId: String { plugin?.adEnvironment.unitID(for: adFormat, configured: configuredAdUnitId) ?? configuredAdUnitId }
    let adFormat: String
    let adRequest: Request
    private var loadID = UUID()
    private var loading: AMBContext?
    private(set) var destroyed = false

    init?(_ ctx: AMBContext) {
        guard let id = ctx.optId(), let adUnitId = ctx.optAdUnitID() else { return nil }
        self.id = id
        configuredAdUnitId = adUnitId
        let format = String(ctx.optString("cls", "").dropLast(2))
        adFormat = format.prefix(1).lowercased() + format.dropFirst()
        adRequest = ctx.optGADRequest()
        plugin = ctx.plugin
        super.init()
    }

    var isActive: Bool { !destroyed && plugin?.ads[id] === self }
    var isPresenting: Bool { false }
    func isLoaded() -> Bool { false }
    func load(_ ctx: AMBContext) { ctx.reject("Ad format does not support load") }
    func show(_ ctx: AMBContext) { ctx.reject("Ad format does not support show") }
    func hide(_ ctx: AMBContext) { ctx.reject("Ad format does not support hide") }

    func destroy() {
        destroyed = true
        loading?.reject("Ad is destroyed")
        loading = nil
        loadID = UUID()
    }

    func beginLoad(_ ctx: AMBContext) -> UUID {
        loading?.reject("Ad load was replaced")
        loading = ctx
        loadID = UUID()
        return loadID
    }

    func acceptsLoad(_ token: UUID) -> Bool { isActive && loading != nil && loadID == token }

    func finishLoad(_ token: UUID, error: Error? = nil) {
        guard acceptsLoad(token) else { return }
        let ctx = loading
        loading = nil
        if let error {
            emit(AMBEvents.adLoadFail, error)
            ctx?.reject(error)
        } else {
            emit(AMBEvents.adLoad)
            ctx?.resolve()
        }
    }

    func emit(_ event: String, _ data: [String: Any] = [:]) {
        guard isActive else { return }
        var payload = data
        payload["adId"] = id
        plugin?.emit(event, data: payload)
    }

    func emit(_ event: String, _ error: Error) {
        emit(event, ["message": error.localizedDescription, "code": (error as NSError).code])
    }

    func emit(_ event: String, _ reward: AdReward) {
        emit(event, ["reward": ["amount": reward.amount, "type": reward.type]])
    }

    func emit(_ event: String, _ size: AdSize) { emit(event, sizeData(size)) }

    func sizeData(_ size: AdSize) -> [String: Any] {
        let scale = plugin?.viewController?.view.window?.screen.scale ?? 1
        return ["size": ["width": size.size.width, "height": size.size.height,
                         "widthInPixels": round(size.size.width * scale),
                         "heightInPixels": round(size.size.height * scale)]]
    }

    func emitPaid(_ value: AdValue, response: ResponseInfo?) {
        var data: [String: Any] = ["adUnitId": adUnitId, "adFormat": adFormat,
            "valueMicros": value.value.multiplying(by: 1_000_000).int64Value,
            "currencyCode": value.currencyCode, "precision": value.precision.rawValue]
        let source = response?.loadedAdNetworkResponseInfo
        data["adSourceName"] = source?.adSourceName
        data["adSourceId"] = source?.adSourceID
        data["adSourceInstanceName"] = source?.adSourceInstanceName
        data["adSourceInstanceId"] = source?.adSourceInstanceID
        for (key, sourceKey) in [("mediationGroupName", "mediation_group_name"),
                                 ("mediationABTestName", "mediation_ab_test_name"),
                                 ("mediationABTestVariant", "mediation_ab_test_variant")] {
            data[key] = response?.extras[sourceKey] as? String
        }
        emit(AMBEvents.adPaid, data)
    }
}
