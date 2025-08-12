import appSettings from "lib/settings";
import { createBuiltInTheme } from "./builder";
import { apply } from "./list";

const WHITE = "rgb(255, 255, 255)";

const dark = createBuiltInTheme("Dark", "dark", "free");
dark.primaryColor = "rgb(35, 39, 42)";
dark.primaryTextColor = "rgb(245, 245, 245)";
dark.secondaryColor = "rgb(45, 49, 52)";
dark.secondaryTextColor = "rgb(228, 228, 228)";
dark.activeColor = "rgb(66, 133, 244)";
dark.linkTextColor = "rgb(138, 180, 248)";
dark.borderColor = "rgba(188, 188, 188, 0.15)";
dark.popupIconColor = "rgb(245, 245, 245)";
dark.popupBackgroundColor = "rgb(35, 39, 42)";
dark.popupTextColor = "rgb(245, 245, 245)";
dark.popupActiveColor = "rgb(66, 133, 244)";
dark.activeTextColor = "rgb(255, 255, 255)";
dark.errorTextColor = "rgb(255, 185, 92)";
dark.dangerColor = "rgb(220, 38, 38)";
dark.scrollbarColor = "rgba(255, 255, 255, 0.2)";
dark.preferredEditorTheme = getSystemEditorTheme(true);

const oled = createBuiltInTheme("OLED");
oled.primaryColor = "rgb(0, 0, 0)";
oled.primaryTextColor = "rgb(255, 255, 255)";
oled.darkenedPrimaryColor = "rgb(0, 0, 0)";
oled.secondaryColor = "rgb(8, 8, 8)";
oled.secondaryTextColor = "rgb(240, 240, 240)";
oled.activeColor = "rgb(0, 122, 255)";
oled.activeIconColor = "rgba(0, 122, 255, 0.8)";
oled.linkTextColor = "rgb(10, 132, 255)";
oled.borderColor = "rgba(255, 255, 255, 0.08)";
oled.popupIconColor = "rgb(255, 255, 255)";
oled.popupBackgroundColor = "rgb(0, 0, 0)";
oled.popupTextColor = "rgb(255, 255, 255)";
oled.popupActiveColor = "rgb(0, 122, 255)";
oled.popupBorderColor = "rgba(255, 255, 255, 0.1)";
oled.boxShadowColor = "rgba(0, 0, 0, 0.8)";
oled.buttonBackgroundColor = "rgb(0, 122, 255)";
oled.buttonTextColor = "rgb(255, 255, 255)";
oled.buttonActiveColor = "rgb(10, 132, 255)";
oled.activeTextColor = "rgb(255, 255, 255)";
oled.errorTextColor = "rgb(255, 69, 58)";
oled.dangerColor = "rgb(255, 69, 58)";
oled.scrollbarColor = "rgba(255, 255, 255, 0.1)";
oled.preferredEditorTheme = "ace/theme/terminal";

const ocean = createBuiltInTheme("Ocean");
ocean.darkenedPrimaryColor = "rgb(19, 19, 26)";
ocean.primaryColor = "rgb(32, 32, 44)";
ocean.primaryTextColor = WHITE;
ocean.secondaryColor = "rgb(38, 38, 53)";
ocean.secondaryTextColor = WHITE;
ocean.activeColor = "rgb(51, 153, 255)";
ocean.linkTextColor = "rgb(181, 180, 233)";
ocean.borderColor = "rgb(122, 122, 163)";
ocean.popupIconColor = WHITE;
ocean.popupBackgroundColor = "rgb(32, 32, 44)";
ocean.popupTextColor = WHITE;
ocean.popupActiveColor = "rgb(255, 215, 0)";
ocean.boxShadowColor = "rgba(0, 0, 0, 0.5)";
ocean.preferredEditorTheme = "ace/theme/solarized_dark";
ocean.preferredFont = "Fira Code";

const bump = createBuiltInTheme("Bump");
bump.darkenedPrimaryColor = "rgb(28, 33, 38)";
bump.primaryColor = "rgb(48, 56, 65)";
bump.primaryTextColor = "rgb(236, 236, 236)";
bump.secondaryColor = "rgb(48, 71, 94)";
bump.secondaryTextColor = "rgb(236, 236, 236)";
bump.activeColor = "rgb(242, 163, 101)";
bump.linkTextColor = "rgb(181, 180, 233)";
bump.borderColor = "rgb(107, 120, 136)";
bump.popupIconColor = "rgb(236, 236, 236)";
bump.popupBackgroundColor = "rgb(48, 56, 65)";
bump.popupTextColor = "rgb(236, 236, 236)";
bump.popupActiveColor = "rgb(255, 215, 0)";
bump.buttonBackgroundColor = "rgb(242, 163, 101)";
bump.buttonTextColor = "rgb(236, 236, 236)";
bump.buttonActiveColor = "rgb(212, 137, 79)";
bump.preferredEditorTheme = "ace/theme/one_dark";

const bling = createBuiltInTheme("Bling");
bling.darkenedPrimaryColor = "rgb(19, 19, 38)";
bling.primaryColor = "rgb(32, 32, 64)";
bling.primaryTextColor = "rgb(255, 189, 105)";
bling.secondaryColor = "rgb(84, 56, 100)";
bling.secondaryTextColor = "rgb(255, 189, 105)";
bling.activeColor = "rgb(255, 99, 99)";
bling.linkTextColor = "rgb(181, 180, 233)";
bling.borderColor = "rgb(93, 93, 151)";
bling.popupIconColor = "rgb(255, 189, 105)";
bling.popupBackgroundColor = "rgb(32, 32, 64)";
bling.popupTextColor = "rgb(255, 189, 105)";
bling.popupActiveColor = "rgb(51, 153, 255)";
bling.buttonBackgroundColor = "rgb(255, 99, 99)";
bling.buttonTextColor = "rgb(255, 189, 105)";
bling.buttonActiveColor = "rgb(160, 99, 52)";
bling.preferredEditorTheme = "ace/theme/tomorrow_night_blue";

const moon = createBuiltInTheme("Moon");
moon.darkenedPrimaryColor = "rgb(20, 24, 29)";
moon.primaryColor = "rgb(34, 40, 49)";
moon.primaryTextColor = "rgb(0, 255, 245)";
moon.secondaryColor = "rgb(57, 62, 70)";
moon.secondaryTextColor = "rgb(0, 255, 245)";
moon.activeColor = "rgb(0, 173, 181)";
moon.linkTextColor = "rgb(181, 180, 233)";
moon.borderColor = "rgb(90, 101, 117)";
moon.popupIconColor = "rgb(0, 255, 245)";
moon.popupBackgroundColor = "rgb(34, 40, 49)";
moon.popupTextColor = "rgb(0, 255, 245)";
moon.popupActiveColor = "rgb(51, 153, 255)";
moon.buttonBackgroundColor = "rgb(0, 173, 181)";
moon.buttonTextColor = "rgb(0, 142, 149)";
moon.buttonActiveColor = "rgb(0, 173, 181)";
moon.preferredEditorTheme = "ace/theme/one_dark";

const atticus = createBuiltInTheme("Atticus");
atticus.darkenedPrimaryColor = "rgb(32, 30, 30)";
atticus.primaryColor = "rgb(54, 51, 51)";
atticus.primaryTextColor = "rgb(246, 233, 233)";
atticus.secondaryColor = "rgb(39, 33, 33)";
atticus.secondaryTextColor = "rgb(246, 233, 233)";
atticus.activeColor = "rgb(225, 100, 40)";
atticus.linkTextColor = "rgb(181, 180, 233)";
atticus.borderColor = "rgb(117, 111, 111)";
atticus.popupIconColor = "rgb(246, 233, 233)";
atticus.popupBackgroundColor = "rgb(54, 51, 51)";
atticus.popupTextColor = "rgb(246, 233, 233)";
atticus.popupActiveColor = "rgb(51, 153, 255)";
atticus.buttonBackgroundColor = "rgb(225, 100, 40)";
atticus.buttonTextColor = "rgb(246, 233, 233)";
atticus.buttonActiveColor = "rgb(0, 145, 153)";
atticus.preferredEditorTheme = "ace/theme/pastel_on_dark";

const tomyris = createBuiltInTheme("Tomyris");
tomyris.darkenedPrimaryColor = "rgb(32, 30, 30)";
tomyris.primaryColor = "rgb(59, 9, 68)";
tomyris.primaryTextColor = "rgb(241, 187, 213)";
tomyris.secondaryColor = "rgb(95, 24, 84)";
tomyris.secondaryTextColor = "rgb(144, 184, 248)";
tomyris.activeColor = "rgb(161, 37, 89)";
tomyris.linkTextColor = "rgb(181, 180, 233)";
tomyris.borderColor = "rgb(140, 58, 155)";
tomyris.popupIconColor = "rgb(241, 187, 213)";
tomyris.popupBackgroundColor = "rgb(59, 9, 68)";
tomyris.popupTextColor = "rgb(241, 187, 213)";
tomyris.popupActiveColor = "rgb(51, 153, 255)";
tomyris.buttonBackgroundColor = "rgb(161, 37, 89)";
tomyris.buttonTextColor = "rgb(241, 187, 213)";
tomyris.buttonActiveColor = "rgb(0, 145, 153)";
tomyris.preferredEditorTheme = "ace/theme/cobalt";

const menes = createBuiltInTheme("Menes");
menes.darkenedPrimaryColor = "rgb(31, 34, 38)";
menes.primaryColor = "rgb(53, 57, 65)";
menes.primaryTextColor = "rgb(144, 184, 248)";
menes.secondaryColor = "rgb(38, 40, 43)";
menes.secondaryTextColor = "rgb(144, 184, 248)";
menes.activeColor = "rgb(95, 133, 219)";
menes.linkTextColor = "rgb(181, 180, 233)";
menes.borderColor = "rgb(117, 123, 134)";
menes.popupIconColor = "rgb(144, 184, 248)";
menes.popupBackgroundColor = "rgb(54, 59, 78)";
menes.popupTextColor = "rgb(144, 184, 248)";
menes.popupActiveColor = "rgb(51, 153, 255)";
menes.buttonBackgroundColor = "rgb(95, 133, 219)";
menes.buttonTextColor = "rgb(144, 184, 248)";
menes.buttonActiveColor = "rgb(0, 145, 153)";
menes.preferredEditorTheme = "ace/theme/nord_dark";

const light = createBuiltInTheme("Light", "light");
light.primaryColor = "rgb(255, 255, 255)";
light.primaryTextColor = "rgb(15, 23, 42)";
light.secondaryColor = "rgb(248, 250, 252)";
light.secondaryTextColor = "rgb(51, 65, 85)";
light.activeColor = "rgb(59, 130, 246)";
light.linkTextColor = "rgb(37, 99, 235)";
light.borderColor = "rgb(226, 232, 240)";
light.popupIconColor = "rgb(15, 23, 42)";
light.popupBackgroundColor = "rgb(255, 255, 255)";
light.popupTextColor = "rgb(15, 23, 42)";
light.popupActiveColor = "rgb(59, 130, 246)";
light.activeTextColor = "rgb(255, 255, 255)";
light.errorTextColor = "rgb(185, 28, 28)";
light.dangerColor = "rgb(220, 38, 38)";
light.scrollbarColor = "rgba(0, 0, 0, 0.2)";
light.preferredEditorTheme = getSystemEditorTheme(false);

const system = createBuiltInTheme("System", "dark", "free");

export function getSystemEditorTheme(darkTheme) {
	if (darkTheme) {
		return "ace/theme/clouds_midnight";
	} else {
		return "ace/theme/crimson_editor";
	}
}

/**
 * Update the system theme based on the user's preference.
 * @param {boolean} darkTheme Whether the user prefers a dark theme.
 */
export function updateSystemTheme(darkTheme) {
	if (darkTheme) {
		system.type = "dark";
		system.primaryColor = "rgb(35, 39, 42)";
		system.primaryTextColor = "rgb(245, 245, 245)";
		system.darkenedPrimaryColor = "rgb(24, 27, 30)";
		system.secondaryColor = "rgb(45, 49, 52)";
		system.secondaryTextColor = "rgb(228, 228, 228)";
		system.activeColor = "rgb(66, 133, 244)";
		system.linkTextColor = "rgb(138, 180, 248)";
		system.borderColor = "rgba(188, 188, 188, 0.15)";
		system.popupIconColor = "rgb(245, 245, 245)";

		system.popupBackgroundColor = "rgb(35, 39, 42)";
		system.popupTextColor = "rgb(245, 245, 245)";
		system.popupActiveColor = "rgb(66, 133, 244)";
	} else {
		system.type = "light";
		system.primaryColor = "rgb(255, 255, 255)";
		system.primaryTextColor = "rgb(15, 23, 42)";
		system.secondaryColor = "rgb(248, 250, 252)";
		system.secondaryTextColor = "rgb(51, 65, 85)";
		system.activeColor = "rgb(59, 130, 246)";
		system.linkTextColor = "rgb(37, 99, 235)";
		system.borderColor = "rgb(226, 232, 240)";
		system.popupIconColor = "rgb(15, 23, 42)";

		system.popupBackgroundColor = "rgb(255, 255, 255)";
		system.popupTextColor = "rgb(15, 23, 42)";
		system.popupActiveColor = "rgb(59, 130, 246)";
	}

	system.preferredEditorTheme = getSystemEditorTheme(darkTheme);

	if (appSettings?.value?.appTheme === "system") {
		apply(system.id);
	}
}

const glass = createBuiltInTheme("Glass");
glass.darkenedPrimaryColor = "rgb(250, 250, 255)";
glass.primaryColor = "rgb(255, 255, 255)";
glass.primaryTextColor = "rgb(17, 24, 39)";
glass.secondaryColor = "rgba(255, 255, 255, 0.8)";
glass.secondaryTextColor = "rgb(55, 65, 81)";
glass.activeColor = "rgb(99, 102, 241)";
glass.linkTextColor = "rgb(79, 70, 229)";
glass.borderColor = "rgba(99, 102, 241, 0.2)";
glass.popupIconColor = "rgb(17, 24, 39)";
glass.popupBackgroundColor = "rgba(255, 255, 255, 0.95)";
glass.popupTextColor = "rgb(17, 24, 39)";
glass.popupActiveColor = "rgb(99, 102, 241)";
glass.buttonBackgroundColor = "rgb(99, 102, 241)";
glass.buttonTextColor = "rgb(255, 255, 255)";
glass.buttonActiveColor = "rgb(79, 70, 229)";
glass.boxShadowColor = "rgba(0, 0, 0, 0.1)";
glass.activeTextColor = "rgb(255, 255, 255)";
glass.errorTextColor = "rgb(185, 28, 28)";
glass.dangerColor = "rgb(220, 38, 38)";
glass.scrollbarColor = "rgba(0, 0, 0, 0.15)";

const neon = createBuiltInTheme("Neon");
neon.darkenedPrimaryColor = "rgb(9, 9, 11)";
neon.primaryColor = "rgb(15, 15, 17)";
neon.primaryTextColor = "rgb(10, 255, 200)";
neon.secondaryColor = "rgb(24, 24, 27)";
neon.secondaryTextColor = "rgb(255, 255, 255)";
neon.activeColor = "rgb(255, 20, 147)";
neon.linkTextColor = "rgb(0, 255, 255)";
neon.borderColor = "rgba(10, 255, 200, 0.3)";
neon.popupIconColor = "rgb(10, 255, 200)";
neon.popupBackgroundColor = "rgb(15, 15, 17)";
neon.popupTextColor = "rgb(10, 255, 200)";
neon.popupActiveColor = "rgb(255, 20, 147)";
neon.buttonBackgroundColor = "rgb(255, 20, 147)";
neon.buttonTextColor = "rgb(0, 0, 0)";
neon.buttonActiveColor = "rgb(0, 255, 255)";
neon.boxShadowColor = "rgba(10, 255, 200, 0.2)";
neon.preferredEditorTheme = "ace/theme/monokai";
neon.activeTextColor = "rgb(0, 0, 0)";
neon.errorTextColor = "rgb(255, 20, 147)";
neon.dangerColor = "rgb(255, 20, 147)";
neon.scrollbarColor = "rgba(10, 255, 200, 0.3)";

const glassDark = createBuiltInTheme("Glass Dark", "dark");
glassDark.darkenedPrimaryColor = "rgb(15, 15, 20)";
glassDark.primaryColor = "rgb(24, 24, 32)";
glassDark.primaryTextColor = "rgb(229, 231, 235)";
glassDark.secondaryColor = "rgba(31, 31, 42, 0.8)";
glassDark.secondaryTextColor = "rgb(156, 163, 175)";
glassDark.activeColor = "rgb(99, 102, 241)";
glassDark.linkTextColor = "rgb(129, 140, 248)";
glassDark.borderColor = "rgba(99, 102, 241, 0.3)";
glassDark.popupIconColor = "rgb(229, 231, 235)";
glassDark.popupBackgroundColor = "rgba(31, 31, 42, 0.95)";
glassDark.popupTextColor = "rgb(229, 231, 235)";
glassDark.popupActiveColor = "rgb(99, 102, 241)";
glassDark.buttonBackgroundColor = "rgb(99, 102, 241)";
glassDark.buttonTextColor = "rgb(255, 255, 255)";
glassDark.buttonActiveColor = "rgb(79, 70, 229)";
glassDark.boxShadowColor = "rgba(0, 0, 0, 0.4)";
glassDark.activeTextColor = "rgb(255, 255, 255)";
glassDark.errorTextColor = "rgb(248, 113, 113)";
glassDark.dangerColor = "rgb(239, 68, 68)";
glassDark.scrollbarColor = "rgba(255, 255, 255, 0.2)";
glassDark.preferredEditorTheme = "ace/theme/one_dark";

const sunset = createBuiltInTheme("Sunset");
sunset.darkenedPrimaryColor = "rgb(251, 243, 235)";
sunset.primaryColor = "rgb(255, 251, 247)";
sunset.primaryTextColor = "rgb(124, 45, 18)";
sunset.secondaryColor = "rgb(254, 235, 217)";
sunset.secondaryTextColor = "rgb(154, 52, 18)";
sunset.activeColor = "rgb(251, 146, 60)";
sunset.linkTextColor = "rgb(234, 88, 12)";
sunset.borderColor = "rgb(253, 186, 116)";
sunset.popupIconColor = "rgb(124, 45, 18)";
sunset.popupBackgroundColor = "rgb(255, 251, 247)";
sunset.popupTextColor = "rgb(124, 45, 18)";
sunset.popupActiveColor = "rgb(251, 146, 60)";
sunset.buttonBackgroundColor = "rgb(251, 146, 60)";
sunset.buttonTextColor = "rgb(255, 255, 255)";
sunset.buttonActiveColor = "rgb(234, 88, 12)";
sunset.activeTextColor = "rgb(255, 255, 255)";
sunset.errorTextColor = "rgb(185, 28, 28)";
sunset.dangerColor = "rgb(220, 38, 38)";
sunset.scrollbarColor = "rgba(124, 45, 18, 0.2)";

const custom = createBuiltInTheme("Custom");
custom.autoDarkened = true;

export default [
	system,
	createBuiltInTheme("Legacy", "dark", "free"),
	dark,
	light,
	glass,
	glassDark,
	neon,
	sunset,
	oled,
	ocean,
	bump,
	bling,
	moon,
	atticus,
	tomyris,
	menes,
	custom,
];
