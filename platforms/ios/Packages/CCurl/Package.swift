// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "AcodeCurl",
    platforms: [.iOS(.v18)],
    products: [.library(name: "AcodeCurl", targets: ["AcodeCurl"])],
    dependencies: [.package(url: "https://github.com/Lakr233/openssl-spm.git", exact: "3.6.2")],
    targets: [
        .target(name: "CCurl", dependencies: [.product(name: "OpenSSL", package: "openssl-spm")],
                path: "Vendor/curl", sources: ["lib"], publicHeadersPath: "include",
                cSettings: [.headerSearchPath("lib"), .define("HAVE_CONFIG_H"), .define("CURL_STATICLIB"), .define("BUILDING_LIBCURL"), .define("USE_APPLE_SECTRUST")],
                linkerSettings: [.linkedFramework("Security"), .linkedFramework("CoreFoundation")]),
        .target(name: "AcodeCurl", dependencies: ["CCurl"], path: "Bridge", publicHeadersPath: "include"),
    ]
)
