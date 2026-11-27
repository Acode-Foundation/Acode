import UserMessagingPlatform
import UIKit

final class AMBPrivacy {
    private weak var plugin: AMBPlugin?
    private var busy = false
    private var presenting = false
    private let information: ConsentInformation

    init(plugin: AMBPlugin, information: ConsentInformation = .shared) {
        self.plugin = plugin
        self.information = information
    }

    var canRequestAds: Bool { information.canRequestAds }
    var state: [String: Any] {
        let status: String
        switch information.consentStatus {
        case .required: status = "required"
        case .notRequired: status = "notRequired"
        case .obtained: status = "obtained"
        default: status = "unknown"
        }
        return ["consentStatus": status, "canRequestAds": canRequestAds,
                "privacyOptionsRequired": information.privacyOptionsRequirementStatus == .required]
    }

    func gather(_ ctx: AMBContext) {
        guard !busy else { ctx.reject("A consent request is already in progress"); return }
        let parameters = RequestParameters()
        if ctx.has("debugGeography") || ctx.has("testDeviceIds") {
            #if DEBUG
            let settings = DebugSettings()
            switch ctx.optString("debugGeography", "disabled") {
            case "disabled": settings.geography = .disabled
            case "eea": settings.geography = .EEA
            case "notEea": settings.geography = .other
            default: ctx.reject("Unknown debug geography"); return
            }
            settings.testDeviceIdentifiers = ctx.optStringArray("testDeviceIds")
            parameters.debugSettings = settings
            #else
            ctx.reject("Consent debug controls require a debug build"); return
            #endif
        }
        busy = true
        information.requestConsentInfoUpdate(with: parameters) { [weak self] error in
            guard let self, ctx.isCurrent else { return }
            if let error { self.finish(ctx, error); return }
            guard self.information.consentStatus == .required else { self.finish(ctx, nil); return }
            ConsentForm.load { [weak self] form, error in
                guard let self, ctx.isCurrent else { return }
                if let error { self.finish(ctx, error); return }
                guard let form else {
                    self.busy = false
                    ctx.reject("Consent form is unavailable")
                    return
                }
                guard let controller = self.presenter(ctx) else { self.busy = false; return }
                self.presenting = true
                form.present(from: controller) { [weak self] error in self?.finish(ctx, error) }
            }
        }
    }

    func showOptions(_ ctx: AMBContext) {
        guard !busy else { ctx.reject("A consent request is already in progress"); return }
        guard information.privacyOptionsRequirementStatus == .required else { ctx.resolve(state); return }
        guard let controller = presenter(ctx) else { return }
        busy = true
        presenting = true
        ConsentForm.presentPrivacyOptionsForm(from: controller) { [weak self] error in
            self?.finish(ctx, error)
        }
    }

    func resetForTesting(_ ctx: AMBContext) {
        #if DEBUG
        guard !busy else { ctx.reject("A consent request is already in progress"); return }
        information.reset()
        plugin?.clearAds()
        ctx.resolve(state)
        #else
        ctx.reject("Consent reset requires a debug build")
        #endif
    }

    func resetPresentation() {
        if presenting { plugin?.viewController?.dismiss(animated: false) }
        presenting = false
        busy = false
    }

    private func presenter(_ ctx: AMBContext) -> UIViewController? {
        guard let controller = plugin?.viewController, controller.view.window != nil,
              controller.presentedViewController == nil,
              controller.view.window?.windowScene?.activationState == .foregroundActive else {
            ctx.reject("Consent requires the foreground app"); return nil
        }
        return controller
    }

    private func finish(_ ctx: AMBContext, _ error: Error?) {
        guard ctx.isCurrent else { return }
        busy = false
        presenting = false
        if !canRequestAds { plugin?.clearAds() }
        if let error { ctx.reject(error) }
        else { ctx.resolve(state) }
    }
}
