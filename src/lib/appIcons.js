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
		id: "pro",
		label: "Acode Pro",
		image: "icons/ic_acode_pro.svg",
		requiresPro: true,
	},
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
	{ id: "prism", label: "Prism", image: "icons/ic_acode_prism.svg" },
	{
		id: "porcelain",
		label: "Porcelain",
		image: "icons/ic_acode_porcelain.svg",
	},
	{
		id: "tangerine",
		label: "Tangerine",
		image: "icons/ic_acode_tangerine.svg",
	},
	{ id: "tidal", label: "Tidal", image: "icons/ic_acode_tidal.svg" },
	{ id: "lilac", label: "Lilac", image: "icons/ic_acode_lilac.svg" },
	{ id: "volt", label: "Volt", image: "icons/ic_acode_volt.svg" },
	{ id: "cobalt", label: "Cobalt", image: "icons/ic_acode_cobalt.svg" },
	{ id: "glacier", label: "Glacier", image: "icons/ic_acode_glacier.svg" },
];

export const APP_ICON_IDS = APP_ICONS.map((icon) => icon.id);
