#if DEBUG
import WebKit

@MainActor
enum SimulatorTestSupport {
    static func disableConsent(in scripts: WKUserContentController) {
        guard !scripts.userScripts.contains(where: { $0.source.contains("iosConsentFixture") }) else { return }
        // Suppress network consent independently of the test's StoreKit entitlements.
        scripts.addUserScript(WKUserScript(source: """
            Object.defineProperty(window,'admob',{configurable:true,set(value){
                value.privacy.gatherConsent=async function iosConsentFixture(){
                    return {consentStatus:'unknown',canRequestAds:false,privacyOptionsRequired:false};
                };
                Object.defineProperty(window,'admob',{configurable:true,writable:true,value});
            }});
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
}
#endif
