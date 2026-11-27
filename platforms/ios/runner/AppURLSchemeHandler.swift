import WebKit

final class AppURLSchemeHandler: NSObject, WKURLSchemeHandler {
    private var active = Set<ObjectIdentifier>()
    private let api = AppAPIHandler()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        if task.request.url?.path.hasPrefix("/__api__/") == true { api.start(task); return }
        let id = ObjectIdentifier(task)
        active.insert(id)
        guard let url = task.request.url, url.host == "localhost" else {
            active.remove(id)
            task.didFailWithError(URLError(.badURL)); return
        }
        let head = task.request.httpMethod == "HEAD"
        let files = AppFiles.shared
        let resource = url.path.hasPrefix("/__cdvfile_") || url.path.hasPrefix("/__file__/") || url.path.hasPrefix("/__cache__/")
            ? url.absoluteString
            : files.application.appendingPathComponent("bundle").appendingPathComponent(url.path == "/" ? "index.html" : url.path).absoluteString
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = Result { () -> (Data, String) in
                let fileURL = try files.resolve(resource)
                return try files.coordinate(fileURL) { (try Data(contentsOf: $0), files.mimeType($0)) }
            }
            DispatchQueue.main.async {
                guard self?.active.remove(id) != nil else { return }
                switch result {
                case .success(let (data, mime)):
                    let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"]
                    guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else { task.didFailWithError(URLError(.badServerResponse)); return }
                    task.didReceive(response)
                    if !head { task.didReceive(data) }
                    task.didFinish()
                case .failure(let error):
                    #if DEBUG
                    print("[scheme] failed \(url.absoluteString) -> \(resource) code=\(FileFailure.code(error))")
                    #endif
                    task.didFailWithError(error)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        api.stop(task)
        active.remove(ObjectIdentifier(task))
    }
}
