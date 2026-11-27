import UIKit

@MainActor
final class PreviewDevicesController: UITableViewController {
    private let presets: [(String, CGFloat, CGFloat)] = [
        ("iPhone SE", 320, 568), ("iPhone 8", 375, 667), ("iPhone 8+", 414, 736), ("iPhone X", 375, 812),
        ("iPad", 768, 1024), ("iPad Pro", 1024, 1366), ("Galaxy S5", 360, 640), ("Pixel 2", 411, 731),
        ("Pixel 2 XL", 411, 823), ("Nexus 5X", 411, 731), ("Nexus 6P", 411, 731), ("Nexus 7", 600, 960),
        ("Nexus 10", 800, 1280), ("Laptop", 1280, 800), ("Laptop L", 1440, 900), ("Laptop XL", 1680, 1050), ("UHD 4k", 3840, 2160),
    ]
    private let width = UITextField()
    private let height = UITextField()
    private let scaleControl = UISlider()
    var onChange: ((CGSize?, CGFloat) -> Void)?

    init(size: CGSize, scale: CGFloat) {
        super.init(style: .insetGrouped)
        width.text = String(Int(size.width)); height.text = String(Int(size.height))
        scaleControl.minimumValue = 0.1; scaleControl.maximumValue = 1; scaleControl.value = Float(scale)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Devices"
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(done))
        for field in [width, height] {
            field.keyboardType = .numberPad
            field.borderStyle = .roundedRect
            field.addTarget(self, action: #selector(update), for: .editingChanged)
        }
        width.accessibilityLabel = "Viewport width"
        height.accessibilityLabel = "Viewport height"
        scaleControl.accessibilityLabel = "Viewport scale"
        scaleControl.addTarget(self, action: #selector(update), for: .valueChanged)
    }

    override func numberOfSections(in tableView: UITableView) -> Int { 2 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { section == 0 ? 4 : presets.count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { section == 0 ? "Custom" : "Presets" }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .value1, reuseIdentifier: nil)
        if indexPath.section == 1 {
            let preset = presets[indexPath.row]
            cell.textLabel?.text = preset.0
            cell.detailTextLabel?.text = "\(Int(preset.1)) × \(Int(preset.2))"
        } else if indexPath.row == 3 { cell.textLabel?.text = "Reset to Device" }
        else {
            cell.textLabel?.text = ["Width", "Height", "Scale"][indexPath.row]
            let control: UIView = [width, height, scaleControl][indexPath.row]
            control.frame = CGRect(x: 0, y: 0, width: 150, height: 32)
            cell.accessoryView = control
            cell.selectionStyle = .none
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        if indexPath.section == 1 {
            let preset = presets[indexPath.row]
            width.text = String(Int(preset.1)); height.text = String(Int(preset.2)); scaleControl.value = 1
            update(); dismiss(animated: true)
        } else if indexPath.row == 3 { onChange?(nil, 1); dismiss(animated: true) }
    }

    @objc private func update() {
        guard let w = Int(width.text ?? ""), let h = Int(height.text ?? ""), (100...7680).contains(w), (100...7680).contains(h) else { return }
        onChange?(CGSize(width: w, height: h), CGFloat(scaleControl.value))
    }

    @objc private func done() { update(); dismiss(animated: true) }
}
