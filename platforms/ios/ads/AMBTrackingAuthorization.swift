import AppTrackingTransparency
import UIKit

@MainActor
final class AMBTrackingAuthorization {
    typealias Completion = (Result<ATTrackingManager.AuthorizationStatus, Error>) -> Void
    private let status: @MainActor () -> ATTrackingManager.AuthorizationStatus
    private let isActive: @MainActor () -> Bool
    private let request: (@escaping @Sendable (ATTrackingManager.AuthorizationStatus) -> Void) -> Void
    private let notifications: NotificationCenter
    private var observer: NSObjectProtocol?
    private var pending: [Completion] = []
    private var requestID: UUID?
    private var deadline: Task<Void, Never>?
    private let timeout: Duration

    init(status: @escaping @MainActor () -> ATTrackingManager.AuthorizationStatus = { ATTrackingManager.trackingAuthorizationStatus },
         isActive: @escaping @MainActor () -> Bool = { UIApplication.shared.applicationState == .active },
         notifications: NotificationCenter = .default,
         timeout: Duration = .seconds(30),
         request: @escaping (@escaping @Sendable (ATTrackingManager.AuthorizationStatus) -> Void) -> Void = ATTrackingManager.requestTrackingAuthorization) {
        self.status = status
        self.isActive = isActive
        self.notifications = notifications
        self.timeout = timeout
        self.request = request
        observer = notifications.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.async { self?.requestWhenActive() }
        }
    }

    deinit {
        deadline?.cancel()
        if let observer { notifications.removeObserver(observer) }
    }

    func authorize(_ completion: @escaping Completion) {
        pending.append(completion)
        if deadline == nil {
            deadline = Task { [weak self, timeout] in
                do { try await Task.sleep(for: timeout) }
                catch { return }
                guard !Task.isCancelled, let self, !self.pending.isEmpty else { return }
                if !self.finishIfDecided() {
                    self.finish(.failure(NSError(domain: "AcodeAds", code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "Tracking authorization is still pending. Please try again."])))
                }
            }
        }
        requestWhenActive()
    }

    func cancel() {
        finish(.failure(NSError(domain: "AcodeAds", code: 1,
                                userInfo: [NSLocalizedDescriptionKey: "Tracking authorization was cancelled"])))
    }

    private func requestWhenActive() {
        guard !pending.isEmpty, !finishIfDecided(), requestID == nil, isActive() else { return }
        let id = UUID()
        requestID = id
        request { [weak self] status in
            DispatchQueue.main.async {
                guard let self, self.requestID == id else { return }
                self.requestID = nil
                if self.finishIfDecided() { return }
                if status != .notDetermined { self.finish(.success(status)) }
                else if self.isActive() {
                    self.finish(.failure(NSError(domain: "AcodeAds", code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "Tracking authorization could not be presented. Please try again."])))
                }
                // An inactive app cannot display ATT. Retry on didBecomeActive.
            }
        }
    }

    private func finishIfDecided() -> Bool {
        let current = status()
        guard current != .notDetermined else { return false }
        requestID = nil
        finish(.success(current))
        return true
    }

    private func finish(_ result: Result<ATTrackingManager.AuthorizationStatus, Error>) {
        deadline?.cancel()
        deadline = nil
        // Cancellation/timeout settles callers, not the OS request. Its ID remains
        // until a callback or a determined OS status proves it is safe to retire.
        let callbacks = pending
        pending.removeAll()
        callbacks.forEach { $0(result) }
    }
}
