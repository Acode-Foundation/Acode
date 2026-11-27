import Foundation
import GoogleMobileAds

protocol AMBCoreContext {
    var plugin: AMBPlugin? { get }
    func has(_ name: String) -> Bool
    func optBool(_ name: String) -> Bool?
    func optFloat(_ name: String) -> Float?
    func optInt(_ name: String) -> Int?
    func optString(_ name: String, _ defaultValue: String) -> String
    func optStringArray(_ name: String) -> [String]?

    func resolve(_ data: [String: Any])
    func resolve(_ data: Bool)

    func reject(_ msg: String)
}

extension AMBCoreContext {
    func optString(_ name: String) -> String? {
        if has(name) {
            return optString(name, "")
        }
        return nil
    }

    func optAppMuted() -> Bool? {
        return optBool("appMuted")
    }

    func optAppVolume() -> Float? {
        return optFloat("appVolume")
    }

    func optId() -> String? {
        return optString("id")
    }

    func optPosition() -> String {
        return optString("position", "bottom")
    }

    func optAdUnitID() -> String? {
        return optString("adUnitId")
    }

    func optAd() -> AMBAdBase? {
        guard let id = optId(),
              let ad = plugin?.ads[id]
        else {
            return nil
        }
        return ad
    }

    func optAdOrError() -> AMBAdBase? {
        if let ad = optAd() {
            return ad
        } else {
            reject("Ad not found: \(optId() ?? "-")")
            return nil
        }
    }

    func optGADMaxAdContentRating() -> GADMaxAdContentRating? {
        switch optString("maxAdContentRating") {
        case "G":
            return GADMaxAdContentRating.general
        case "MA":
            return GADMaxAdContentRating.matureAudience
        case "PG":
            return GADMaxAdContentRating.parentalGuidance
        case "T":
            return GADMaxAdContentRating.teen
        default:
            return nil
        }
    }

    func optChildDirectedTreatmentTag() -> Bool? {
        return optBool("tagForChildDirectedTreatment")
    }

    func optUnderAgeOfConsentTag() -> Bool? {
        return optBool("tagForUnderAgeOfConsent")
    }

    func optTestDeviceIds() -> [String]? {
        return optStringArray("testDeviceIds")
    }

    func optGADRequest() -> Request {
        let request = Request()
        request.scene = plugin?.viewController?.view.window?.windowScene
        if let contentURL = optString("contentUrl") {
            request.contentURL = contentURL
        }
        if let keywords = optStringArray("keywords") {
            request.keywords = keywords
        }
        let extras = Extras()
        if let npa = optString("npa") {
            extras.additionalParameters = ["npa": npa]
        }
        request.register(extras)
        return request
    }

    func resolve() {
        resolve([:])
    }

    func resolve(_ data: Bool) {
        resolve(["value": data])
    }

    func reject() {
        return reject(NSError(domain: "AdMob", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid ad options"]))
    }

    func reject(_ error: Error) {
        reject(error.localizedDescription)
    }

    @MainActor
    func configure() {
        if let muted = optAppMuted() {
            MobileAds.shared.isApplicationMuted = muted
        }
        if let volume = optAppVolume() {
            MobileAds.shared.applicationVolume = volume
        }

        let requestConfiguration = MobileAds.shared.requestConfiguration
        if let maxAdContentRating = optGADMaxAdContentRating() {
            requestConfiguration.maxAdContentRating = maxAdContentRating
        }
        plugin?.configureAgeTreatment(childDirected: optChildDirectedTreatmentTag(), underAgeOfConsent: optUnderAgeOfConsentTag())
        if let testDevices = optTestDeviceIds() {
            requestConfiguration.testDeviceIdentifiers = testDevices
        }
        if let sameAppKey = optBool("sameAppKey") {
            requestConfiguration.setPublisherFirstPartyIDEnabled(sameAppKey)
        }
        if let
        publisherFirstPartyIDEnabled = optBool("publisherFirstPartyIDEnabled") {
            requestConfiguration.setPublisherFirstPartyIDEnabled(publisherFirstPartyIDEnabled)
        }

        resolve()
    }
}
