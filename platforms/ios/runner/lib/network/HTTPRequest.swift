import Foundation

struct HTTPRequest {
    let id: Int
    var request: URLRequest
    let followRedirects: Bool
    let responseType: String
    let destination: URL?
    let connectTimeout: TimeInterval
    let readTimeout: TimeInterval

    init(action: String, args: [Any]) throws {
        guard let address = args[safe: 0] as? String, let url = URL(string: address),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
            throw HTTPFailure(status: -5, message: "Expected an HTTP or HTTPS URL")
        }
        let hasBody = ["post", "put", "patch"].contains(action)
        let upload = action == "uploadFiles"
        let download = action == "downloadFile"
        guard hasBody || upload || download || ["get", "head", "delete", "options"].contains(action) else {
            throw HTTPFailure(status: -1, message: "Unknown HTTP action: \(action)")
        }
        let offset = hasBody || upload ? 4 : download ? 3 : 2
        guard let id = args[safe: download ? 6 : offset + 4] as? Int else {
            throw HTTPFailure(status: -1, message: "Request ID is required")
        }
        self.id = id
        connectTimeout = args[safe: offset] as? Double ?? 60
        readTimeout = args[safe: offset + 1] as? Double ?? 60
        followRedirects = args[safe: offset + 2] as? Bool ?? true
        responseType = download ? "text" : args[safe: offset + 3] as? String ?? "text"
        destination = download ? try AppFiles.shared.resolve(args[safe: 2] as? String ?? "") : nil
        request = URLRequest(url: url)
        request.httpMethod = upload ? "POST" : download ? "GET" : action.uppercased()
        request.allHTTPHeaderFields = args[safe: hasBody ? 3 : 1] as? [String: String] ?? [:]
        request.httpShouldHandleCookies = false
        if hasBody {
            let body = try HTTPBody.encode(args[safe: 1], serializer: args[safe: 2] as? String ?? "urlencoded")
            request.httpBody = body.data
            if request.value(forHTTPHeaderField: "Content-Type") == nil { request.setValue(body.type, forHTTPHeaderField: "Content-Type") }
        } else if upload {
            let body = try HTTPBody.files(paths: args[safe: 2] as? [String] ?? [], names: args[safe: 3] as? [String] ?? [])
            request.httpBody = body.data
            request.setValue(body.type, forHTTPHeaderField: "Content-Type")
        }
    }
}

struct HTTPFailure: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
    static func status(_ error: Error) -> Int {
        if let failure = error as? HTTPFailure { return failure.status }
        switch (error as NSError).code {
        case NSURLErrorCancelled: return -8
        case NSURLErrorTimedOut: return -4
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: return -3
        case NSURLErrorNotConnectedToInternet: return -6
        case NSURLErrorUnsupportedURL, NSURLErrorBadURL: return -5
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
             NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot,
             NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected,
             NSURLErrorClientCertificateRequired: return -2
        default: return -1
        }
    }
}
