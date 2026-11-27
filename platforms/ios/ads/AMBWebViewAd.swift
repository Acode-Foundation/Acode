import Foundation

// Web ad markup is owned by the existing JavaScript WebViewAd API.
final class AMBWebViewAd: AMBAdBase {
    override func load(_ ctx: AMBContext) { ctx.resolve() }
    override func show(_ ctx: AMBContext) { ctx.resolve() }
    override func hide(_ ctx: AMBContext) { ctx.resolve() }
}
