import UIKit
import AVFoundation

final class ScannerService: BaseService {

    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var overlayView: UIView?
    private var metadataOutput: AVCaptureMetadataOutput?

    private var scanCallback: Callback?
    private var scanOnce = false
    private var onShowCallback: Callback?
    private var onHideCallback: Callback?
    private var overlayColor: UIColor = UIColor.black.withAlphaComponent(0.85)
    private var cornerRadius: CGFloat = 16

    override func exec(action: String, args: [Any], callback: Callback) {
        switch action {
        case "show":              show(args: args, callback: callback)
        case "hide":              hide(args: args, callback: callback)
        case "scan":              scan(args: args, callback: callback)
        case "update":            update(args: args, callback: callback)
        case "setTheme":          setTheme(args: args, callback: callback)
        case "setOnShowListener": onShowCallback = callback; callback.success(nil, keep: true)
        case "setOnHideListener": onHideCallback = callback; callback.success(nil, keep: true)
        default:                  callback.error("Unknown action: \(action)")
        }
    }

    // MARK: - show

    private func show(args: [Any], callback: Callback) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let vc = self.viewController else { return }

            var x: CGFloat = 0
            var y: CGFloat = 0
            var w: CGFloat = vc.view.bounds.width
            var h: CGFloat = vc.view.bounds.height

            if let dims = args[safe: 0] as? [String: Any] {
                x = CGFloat((dims["x"] as? Double) ?? 0)
                y = CGFloat((dims["y"] as? Double) ?? 0)
                w = CGFloat((dims["w"] as? Double) ?? Double(w))
                h = CGFloat((dims["h"] as? Double) ?? Double(h))
            }

            let overlay = UIView(frame: CGRect(x: x, y: y, width: w, height: h))
            overlay.backgroundColor = self.overlayColor
            overlay.layer.cornerRadius = self.cornerRadius
            overlay.clipsToBounds = true
            self.overlayView = overlay
            vc.view.addSubview(overlay)

            self.startCamera(in: overlay) { success, reason in
                if success {
                    callback.success()
                    self.onShowCallback?.success(nil, keep: true)
                } else {
                    overlay.removeFromSuperview()
                    self.overlayView = nil
                    callback.error(reason ?? "Failed to start camera")
                }
            }
        }
    }

    // MARK: - update

    private func update(args: [Any], callback: Callback){
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let overlay = self.overlayView else {
                callback.error("No active overlay")
                return
            }

            var x: CGFloat = overlay.frame.origin.x
            var y: CGFloat = overlay.frame.origin.y
            var w: CGFloat = overlay.frame.width
            var h: CGFloat = overlay.frame.height

            if let dims = args[safe: 0] as? [String: Any] {
                x = CGFloat((dims["x"] as? Double) ?? Double(x))
                y = CGFloat((dims["y"] as? Double) ?? Double(y))
                w = CGFloat((dims["w"] as? Double) ?? Double(w))
                h = CGFloat((dims["h"] as? Double) ?? Double(h))
            }

            overlay.frame = CGRect(x: x, y: y, width: w, height: h)
            self.previewLayer?.frame = overlay.bounds
            callback.success()
        }
    }

    // MARK: - hide

    private func hide(args: [Any], callback: Callback) {
        DispatchQueue.main.async { [weak self] in
            self?.stopCamera()
            callback.success()
            self?.onHideCallback?.success(nil, keep: true)
        }
    }

    // MARK: - scan

    private func scan(args: [Any], callback: Callback) {
        scanOnce = (args[safe: 0] as? Bool) == true || (args[safe: 0] as? Int) == 1
        scanCallback = callback
        // Match Android: keep the callback pending until a scan result is emitted.
    }

    // MARK: - setTheme

    private func setTheme(args: [Any], callback: Callback) {
        let theme: [String: Any]?
        if let dict = args[safe: 0] as? [String: Any] {
            theme = dict
        } else if let themeStr = args[safe: 0] as? String,
                  let data = themeStr.data(using: .utf8) {
            theme = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        } else {
            theme = nil
        }
        guard let theme else {
            callback.error("Invalid theme JSON"); return
        }
        if let bg = theme["popupBackground"] as? String, let color = UIColor(hexString: bg) {
            overlayColor = color
            DispatchQueue.main.async { [weak self] in
                self?.overlayView?.backgroundColor = color
            }
        }
        if let radius = (theme["cornerRadius"] as? String).flatMap({ Double($0) }) {
            cornerRadius = CGFloat(radius)
            DispatchQueue.main.async { [weak self] in
                self?.overlayView?.layer.cornerRadius = CGFloat(radius)
            }
        }
        callback.success()
    }

    // MARK: - Camera setup

    private func startCamera(in container: UIView, completion: @escaping (Bool, String?) -> Void) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            startCameraSession(in: container, completion: completion)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        self.startCameraSession(in: container, completion: completion)
                    } else {
                        completion(false, "Camera permission denied")
                    }
                }
            }
        case .denied, .restricted:
            completion(false, "Camera permission denied — enable it in Settings")
        @unknown default:
            completion(false, "Camera permission unknown status")
        }
    }

    private func startCameraSession(in container: UIView, completion: @escaping (Bool, String?) -> Void) {
        guard let device = AVCaptureDevice.default(for: .video) else {
            completion(false, "No camera device available"); return
        }
        guard let input = try? AVCaptureDeviceInput(device: device) else {
            completion(false, "Failed to create camera input"); return
        }

        let session = AVCaptureSession()
        session.beginConfiguration()

        guard session.canAddInput(input) else { completion(false, "Cannot add camera input to session"); return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { completion(false, "Cannot add metadata output to session"); return }
        session.addOutput(output)

        // QR codes only
        output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
        output.metadataObjectTypes = [.qr]
        session.commitConfiguration()

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = container.bounds

        // Non-deprecated rotation — requires iOS 17+
        if let connection = preview.connection, connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = currentVideoRotationAngle()
        }

        container.layer.insertSublayer(preview, at: 0)

        self.captureSession  = session
        self.previewLayer    = preview
        self.metadataOutput  = output

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
            DispatchQueue.main.async {
                if session.isRunning {
                    completion(true, nil)
                } else {
                    completion(false, "Session failed to start running")
                }
            }
        }
    }

    private func stopCamera() {
        captureSession?.stopRunning()
        captureSession  = nil
        previewLayer?.removeFromSuperlayer()
        previewLayer    = nil
        metadataOutput  = nil
        overlayView?.removeFromSuperview()
        overlayView     = nil
        scanOnce        = false
        scanCallback    = nil
    }

    // MARK: - Rotation

    private func currentVideoRotationAngle() -> CGFloat {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.first
        switch scene?.interfaceOrientation {
        case .landscapeRight:        return 0
        case .landscapeLeft:         return 180
        case .portraitUpsideDown:    return 270
        default:                     return 90  // .portrait
        }
    }
}

// MARK: - AVCaptureMetadataOutputObjectsDelegate

extension ScannerService: AVCaptureMetadataOutputObjectsDelegate {
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let scanCallback = scanCallback, !metadataObjects.isEmpty else { return }

        let results: [[String: Any]] = metadataObjects.compactMap { obj in
            guard let readable = obj as? AVMetadataMachineReadableCodeObject else { return nil }
            return [
                "rawValue":     readable.stringValue ?? "",
                "displayValue": readable.stringValue ?? "",
                "format":       "256",   // FORMAT_QR_CODE numeric value
                "valueType":    "0",
            ]
        }

        guard !results.isEmpty else { return }

        if scanOnce {
            self.scanCallback = nil
            scanCallback.success(results, keep: false)
            DispatchQueue.main.async { self.stopCamera() }
        } else {
            scanCallback.success(results, keep: true)
        }
    }
}
