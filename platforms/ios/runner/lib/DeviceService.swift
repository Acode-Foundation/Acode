import UIKit
import Darwin

final class DeviceService: BaseService {

    override func exec(action: String, args: [Any], callback: Callback) {
        switch action {
        case "getDeviceInfo":
            DispatchQueue.main.async {
                #if targetEnvironment(simulator)
                let virtual = true
                #else
                let virtual = false
                #endif
                let device = UIDevice.current
                callback.success(["platform": "iOS", "version": device.systemVersion, "uuid": device.identifierForVendor?.uuidString ?? "unknown", "model": device.model, "manufacturer": "Apple", "isVirtual": virtual, "serial": "unknown"])
            }
        case "id": deviceId(callback: callback)
        default:   callback.error("Unknown action: \(action)")
        }
    }

    private func deviceId(callback: Callback) {
        let device    = UIDevice.current
        let screen    = UIScreen.main
        let scale     = screen.scale
        let bounds    = screen.bounds
        let width     = Int(bounds.width * scale)
        let height    = Int(bounds.height * scale)
        let dpi       = Int(160 * scale)
        let vendorId  = device.identifierForVendor?.uuidString ?? "unknown"
        let modelId   = hardwareModel()
        let id        = "Apple_\(modelId)_\(width)_\(height)_\(dpi)_\(vendorId)"
        callback.success(id)
    }

    private func hardwareModel() -> String {
        var size: Int = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        var machine = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        return String(cString: machine)
    }
}
