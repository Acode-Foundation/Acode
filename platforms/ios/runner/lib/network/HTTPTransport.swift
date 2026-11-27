import Foundation

final class HTTPTransport: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    let queue = DispatchQueue(label: "app.acode.http." + UUID().uuidString)
    var onResponse: (HTTPURLResponse) throws -> Void = { _ in }
    var onData: (Data) throws -> Void = { _ in }
    var onComplete: (Error?) -> Void = { _ in }
    var allowRedirect: (URL) -> Bool = { _ in true }
    var onRedirect: (HTTPURLResponse, inout URLRequest) throws -> Void = { _, _ in }
    private let request: URLRequest
    private let followRedirects: Bool
    private let connectTimeout: TimeInterval
    private let readTimeout: TimeInterval
    private let trust: HTTPTrust
    private let cookieStorage: HTTPCookieStorage?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var timer: DispatchSourceTimer?
    private var failure: Error?
    private var paused = false
    private var finished = false

    init(request: URLRequest, followRedirects: Bool, connectTimeout: TimeInterval, readTimeout: TimeInterval, trust: HTTPTrust = HTTPTrust(), cookieStorage: HTTPCookieStorage? = nil) {
        self.request = request
        self.followRedirects = followRedirects
        self.connectTimeout = connectTimeout
        self.readTimeout = readTimeout
        self.trust = trust
        self.cookieStorage = cookieStorage
    }

    func start() {
        queue.async {
            guard !self.finished else { return }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpCookieStorage = self.cookieStorage
            configuration.urlCache = nil
            configuration.timeoutIntervalForRequest = 31536000
            configuration.timeoutIntervalForResource = 31536000
            let delegates = OperationQueue()
            delegates.maxConcurrentOperationCount = 1
            delegates.underlyingQueue = self.queue
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegates)
            self.session = session
            self.task = session.dataTask(with: self.request)
            self.resetTimeout(self.connectTimeout)
            self.task?.resume()
        }
    }

    func cancel() {
        queue.async {
            self.failure = URLError(.cancelled)
            if let task = self.task { task.cancel() }
            else { self.finish(self.failure) }
        }
    }

    func setPaused(_ value: Bool) {
        guard value != paused, !finished else { return }
        paused = value
        if value { task?.suspend(); resetTimeout(0) }
        else { resetTimeout(readTimeout); task?.resume() }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        do {
            if let failure { throw failure }
            guard let response = response as? HTTPURLResponse else { throw HTTPFailure(status: -1, message: "Invalid HTTP response") }
            resetTimeout(readTimeout)
            try onResponse(response)
            completionHandler(.allow)
        } catch { failure = error; completionHandler(.cancel) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard failure == nil, !finished else { return }
        do { resetTimeout(paused ? 0 : readTimeout); try onData(data) }
        catch { failure = error; dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(failure ?? error)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        if followRedirects, let url = request.url, !allowRedirect(url) {
            failure = URLError(.redirectToNonExistentLocation)
            completionHandler(nil); return
        }
        var redirect = request
        if followRedirects {
            do { try onRedirect(response, &redirect) }
            catch { failure = error; completionHandler(nil); return }
        }
        if request.url?.host != task.currentRequest?.url?.host || request.url?.scheme != task.currentRequest?.url?.scheme || request.url?.port != task.currentRequest?.url?.port {
            for header in ["Authorization", "Cookie", "Proxy-Authorization"] { redirect.setValue(nil, forHTTPHeaderField: header) }
        }
        completionHandler(followRedirects ? redirect : nil)
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        trust.respond(challenge, completion: completionHandler)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        trust.respond(challenge, completion: completionHandler)
    }

    private func resetTimeout(_ seconds: TimeInterval) {
        timer?.cancel(); timer = nil
        guard seconds > 0 else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + seconds)
        timer.setEventHandler { [weak self] in
            self?.failure = URLError(.timedOut)
            self?.task?.cancel()
        }
        self.timer = timer
        timer.resume()
    }

    private func finish(_ error: Error?) {
        guard !finished else { return }
        finished = true
        resetTimeout(0)
        onComplete(error)
        session?.finishTasksAndInvalidate()
        session = nil; task = nil
        onResponse = { _ in }; onData = { _ in }; onComplete = { _ in }; onRedirect = { _, _ in }
    }
}
