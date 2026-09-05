/**
 * Available app icons that can be selected from the settings.
 * The `id` matches the icon names accepted by `system.setAppIcon`.
 * The `image` is a relative path (relative to the www root) to an SVG
 * preview that is rendered inside the UI.
 */

// Update system.java map too if this is updated
export const APP_ICONS = [
	{ id: "default", label: "Default", image: "icons/ic_acode_default.svg" },
	{
		id: "midnight_circuit",
		label: "Midnight Circuit",
		image: "icons/ic_acode_midnight_circuit.svg",
	},
	{
		id: "aurora_pulse",
		label: "Aurora Pulse",
		image: "icons/ic_acode_aurora_pulse.svg",
	},
	{
		id: "terminal_glow",
		label: "Terminal Glow",
		image: "icons/ic_acode_terminal_glow.svg",
	},
	{
		id: "solar_flare",
		label: "Solar Flare",
		image: "icons/ic_acode_solar_flare.svg",
	},
	{
		id: "blueprint",
		label: "Blueprint",
		image: "icons/ic_acode_blueprint.svg",
	},
	{
		id: "pixel_party",
		label: "Pixel Party",
		image: "icons/ic_acode_pixel_party.svg",
	},
];

export const APP_ICON_IDS = APP_ICONS.map((icon) => icon.id);

export function getAppIconLabel(id) {
	const icon = APP_ICONS.find((item) => item.id === id);
	return icon ? icon.label : APP_ICONS[0].label;
}
