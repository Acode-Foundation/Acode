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
oled.preferredEditorTheme = "tokyoNight";

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
ocean.preferredEditorTheme = "solarizedDark";
ocean.preferredFont = "Fira Code";

const bump = createBuiltInTheme("Bump");
bump.darkenedPrimaryColor = "rgb(24, 28, 36)";
bump.primaryColor = "rgb(36, 40, 52)";
bump.primaryTextColor = "rgb(230, 232, 238)";
bump.secondaryColor = "rgb(44, 50, 64)";
bump.secondaryTextColor = "rgb(175, 180, 192)";
bump.activeColor = "rgb(240, 113, 103)";
bump.linkTextColor = "rgb(255, 150, 130)";
bump.borderColor = "rgba(175, 180, 192, 0.2)";
bump.popupIconColor = "rgb(230, 232, 238)";
bump.popupBackgroundColor = "rgb(40, 44, 58)";
bump.popupTextColor = "rgb(230, 232, 238)";
bump.popupActiveColor = "rgb(240, 113, 103)";
bump.buttonBackgroundColor = "rgb(240, 113, 103)";
bump.buttonTextColor = "rgb(255, 255, 255)";
bump.buttonActiveColor = "rgb(210, 90, 80)";
bump.boxShadowColor = "rgba(0, 0, 0, 0.35)";
bump.activeTextColor = "rgb(255, 255, 255)";
bump.errorTextColor = "rgb(255, 180, 100)";
bump.dangerColor = "rgb(240, 70, 60)";
bump.scrollbarColor = "rgba(230, 232, 238, 0.12)";
bump.preferredEditorTheme = "one_dark";

const bling = createBuiltInTheme("Bling");
bling.darkenedPrimaryColor = "rgb(16, 12, 28)";
bling.primaryColor = "rgb(25, 20, 40)";
bling.primaryTextColor = "rgb(228, 225, 240)";
bling.secondaryColor = "rgb(35, 28, 55)";
bling.secondaryTextColor = "rgb(170, 165, 190)";
bling.activeColor = "rgb(80, 200, 155)";
bling.linkTextColor = "rgb(120, 220, 180)";
bling.borderColor = "rgba(80, 200, 155, 0.2)";
bling.popupIconColor = "rgb(228, 225, 240)";
bling.popupBackgroundColor = "rgb(30, 24, 48)";
bling.popupTextColor = "rgb(228, 225, 240)";
bling.popupActiveColor = "rgb(80, 200, 155)";
bling.buttonBackgroundColor = "rgb(80, 200, 155)";
bling.buttonTextColor = "rgb(16, 12, 28)";
bling.buttonActiveColor = "rgb(55, 170, 130)";
bling.boxShadowColor = "rgba(0, 0, 0, 0.45)";
bling.activeTextColor = "rgb(16, 12, 28)";
bling.errorTextColor = "rgb(255, 170, 100)";
bling.dangerColor = "rgb(240, 85, 85)";
bling.scrollbarColor = "rgba(228, 225, 240, 0.1)";
bling.preferredEditorTheme = "tokyoNight";

const moon = createBuiltInTheme("Moon");
moon.darkenedPrimaryColor = "rgb(16, 20, 26)";
moon.primaryColor = "rgb(26, 32, 42)";
moon.primaryTextColor = "rgb(210, 225, 230)";
moon.secondaryColor = "rgb(34, 42, 54)";
moon.secondaryTextColor = "rgb(150, 170, 180)";
moon.activeColor = "rgb(0, 188, 194)";
moon.linkTextColor = "rgb(80, 220, 225)";
moon.borderColor = "rgba(0, 188, 194, 0.2)";
moon.popupIconColor = "rgb(210, 225, 230)";
moon.popupBackgroundColor = "rgb(30, 38, 48)";
moon.popupTextColor = "rgb(210, 225, 230)";
moon.popupActiveColor = "rgb(0, 188, 194)";
moon.buttonBackgroundColor = "rgb(0, 188, 194)";
moon.buttonTextColor = "rgb(16, 20, 26)";
moon.buttonActiveColor = "rgb(0, 155, 160)";
moon.boxShadowColor = "rgba(0, 0, 0, 0.4)";
moon.activeTextColor = "rgb(16, 20, 26)";
moon.errorTextColor = "rgb(255, 170, 105)";
moon.dangerColor = "rgb(235, 75, 70)";
moon.scrollbarColor = "rgba(210, 225, 230, 0.12)";
moon.preferredEditorTheme = "tokyoNight";

const atticus = createBuiltInTheme("Atticus");
atticus.darkenedPrimaryColor = "rgb(26, 24, 22)";
atticus.primaryColor = "rgb(38, 36, 33)";
atticus.primaryTextColor = "rgb(228, 222, 212)";
atticus.secondaryColor = "rgb(48, 45, 40)";
atticus.secondaryTextColor = "rgb(175, 168, 155)";
atticus.activeColor = "rgb(130, 170, 90)";
atticus.linkTextColor = "rgb(155, 195, 115)";
atticus.borderColor = "rgba(130, 170, 90, 0.2)";
atticus.popupIconColor = "rgb(228, 222, 212)";
atticus.popupBackgroundColor = "rgb(42, 40, 36)";
atticus.popupTextColor = "rgb(228, 222, 212)";
atticus.popupActiveColor = "rgb(130, 170, 90)";
atticus.buttonBackgroundColor = "rgb(130, 170, 90)";
atticus.buttonTextColor = "rgb(38, 36, 33)";
atticus.buttonActiveColor = "rgb(105, 145, 70)";
atticus.boxShadowColor = "rgba(0, 0, 0, 0.35)";
atticus.activeTextColor = "rgb(38, 36, 33)";
atticus.errorTextColor = "rgb(240, 160, 90)";
atticus.dangerColor = "rgb(210, 65, 55)";
atticus.scrollbarColor = "rgba(228, 222, 212, 0.12)";
atticus.preferredEditorTheme = "monokai";

const tomyris = createBuiltInTheme("Tomyris");
tomyris.darkenedPrimaryColor = "rgb(22, 12, 20)";
tomyris.primaryColor = "rgb(32, 18, 28)";
tomyris.primaryTextColor = "rgb(235, 225, 232)";
tomyris.secondaryColor = "rgb(45, 26, 38)";
tomyris.secondaryTextColor = "rgb(185, 170, 178)";
tomyris.activeColor = "rgb(232, 75, 145)";
tomyris.linkTextColor = "rgb(250, 130, 180)";
tomyris.borderColor = "rgba(232, 75, 145, 0.2)";
tomyris.popupIconColor = "rgb(235, 225, 232)";
tomyris.popupBackgroundColor = "rgb(38, 22, 33)";
tomyris.popupTextColor = "rgb(235, 225, 232)";
tomyris.popupActiveColor = "rgb(232, 75, 145)";
tomyris.buttonBackgroundColor = "rgb(232, 75, 145)";
tomyris.buttonTextColor = "rgb(255, 255, 255)";
tomyris.buttonActiveColor = "rgb(200, 55, 120)";
tomyris.boxShadowColor = "rgba(0, 0, 0, 0.45)";
tomyris.activeTextColor = "rgb(255, 255, 255)";
tomyris.errorTextColor = "rgb(255, 175, 100)";
tomyris.dangerColor = "rgb(235, 65, 65)";
tomyris.scrollbarColor = "rgba(235, 225, 232, 0.1)";
tomyris.preferredEditorTheme = "monokai";

const menes = createBuiltInTheme("Menes");
menes.darkenedPrimaryColor = "rgb(18, 22, 28)";
menes.primaryColor = "rgb(28, 32, 40)";
menes.primaryTextColor = "rgb(225, 230, 240)";
menes.secondaryColor = "rgb(36, 42, 52)";
menes.secondaryTextColor = "rgb(140, 155, 175)";
menes.activeColor = "rgb(72, 210, 120)";
menes.linkTextColor = "rgb(100, 230, 150)";
menes.borderColor = "rgba(72, 210, 120, 0.18)";
menes.popupIconColor = "rgb(225, 230, 240)";
menes.popupBackgroundColor = "rgb(32, 38, 48)";
menes.popupTextColor = "rgb(225, 230, 240)";
menes.popupActiveColor = "rgb(72, 210, 120)";
menes.buttonBackgroundColor = "rgb(72, 210, 120)";
menes.buttonTextColor = "rgb(18, 22, 30)";
menes.buttonActiveColor = "rgb(50, 180, 95)";
menes.boxShadowColor = "rgba(0, 0, 0, 0.4)";
menes.activeTextColor = "rgb(18, 22, 30)";
menes.errorTextColor = "rgb(255, 165, 95)";
menes.dangerColor = "rgb(240, 75, 65)";
menes.scrollbarColor = "rgba(225, 230, 240, 0.12)";
menes.preferredEditorTheme = "one_dark";

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
		return "one_dark";
	} else {
		return "noctisLilac";
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
neon.preferredEditorTheme = "monokai";
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
glassDark.preferredEditorTheme = "tokyoNight";

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

const obsidian = createBuiltInTheme("Obsidian");
obsidian.darkenedPrimaryColor = "rgb(18, 17, 21)";
obsidian.primaryColor = "rgb(28, 27, 31)";
obsidian.primaryTextColor = "rgb(232, 228, 220)";
obsidian.secondaryColor = "rgb(38, 37, 42)";
obsidian.secondaryTextColor = "rgb(185, 180, 172)";
obsidian.activeColor = "rgb(212, 175, 55)";
obsidian.linkTextColor = "rgb(230, 200, 120)";
obsidian.borderColor = "rgba(212, 175, 55, 0.18)";
obsidian.popupIconColor = "rgb(232, 228, 220)";
obsidian.popupBackgroundColor = "rgb(32, 31, 36)";
obsidian.popupTextColor = "rgb(232, 228, 220)";
obsidian.popupActiveColor = "rgb(212, 175, 55)";
obsidian.buttonBackgroundColor = "rgb(212, 175, 55)";
obsidian.buttonTextColor = "rgb(28, 27, 31)";
obsidian.buttonActiveColor = "rgb(184, 148, 36)";
obsidian.boxShadowColor = "rgba(0, 0, 0, 0.45)";
obsidian.activeTextColor = "rgb(28, 27, 31)";
obsidian.errorTextColor = "rgb(255, 152, 100)";
obsidian.dangerColor = "rgb(220, 80, 60)";
obsidian.scrollbarColor = "rgba(212, 175, 55, 0.18)";
obsidian.preferredEditorTheme = "one_dark";

const ember = createBuiltInTheme("Ember");
ember.darkenedPrimaryColor = "rgb(22, 16, 13)";
ember.primaryColor = "rgb(32, 24, 20)";
ember.primaryTextColor = "rgb(240, 228, 210)";
ember.secondaryColor = "rgb(45, 35, 28)";
ember.secondaryTextColor = "rgb(200, 185, 165)";
ember.activeColor = "rgb(217, 130, 60)";
ember.linkTextColor = "rgb(240, 170, 100)";
ember.borderColor = "rgba(217, 130, 60, 0.22)";
ember.popupIconColor = "rgb(240, 228, 210)";
ember.popupBackgroundColor = "rgb(38, 30, 24)";
ember.popupTextColor = "rgb(240, 228, 210)";
ember.popupActiveColor = "rgb(217, 130, 60)";
ember.buttonBackgroundColor = "rgb(217, 130, 60)";
ember.buttonTextColor = "rgb(32, 24, 20)";
ember.buttonActiveColor = "rgb(190, 105, 40)";
ember.boxShadowColor = "rgba(0, 0, 0, 0.4)";
ember.activeTextColor = "rgb(32, 24, 20)";
ember.errorTextColor = "rgb(255, 160, 85)";
ember.dangerColor = "rgb(220, 60, 50)";
ember.scrollbarColor = "rgba(240, 228, 210, 0.12)";
ember.preferredEditorTheme = "monokai";

const dusk = createBuiltInTheme("Dusk");
dusk.darkenedPrimaryColor = "rgb(13, 11, 24)";
dusk.primaryColor = "rgb(20, 18, 35)";
dusk.primaryTextColor = "rgb(215, 210, 235)";
dusk.secondaryColor = "rgb(30, 27, 50)";
dusk.secondaryTextColor = "rgb(160, 155, 185)";
dusk.activeColor = "rgb(167, 105, 220)";
dusk.linkTextColor = "rgb(190, 150, 240)";
dusk.borderColor = "rgba(167, 105, 220, 0.2)";
dusk.popupIconColor = "rgb(215, 210, 235)";
dusk.popupBackgroundColor = "rgb(25, 23, 42)";
dusk.popupTextColor = "rgb(215, 210, 235)";
dusk.popupActiveColor = "rgb(167, 105, 220)";
dusk.buttonBackgroundColor = "rgb(167, 105, 220)";
dusk.buttonTextColor = "rgb(255, 255, 255)";
dusk.buttonActiveColor = "rgb(140, 80, 195)";
dusk.boxShadowColor = "rgba(0, 0, 0, 0.5)";
dusk.activeTextColor = "rgb(255, 255, 255)";
dusk.errorTextColor = "rgb(255, 170, 110)";
dusk.dangerColor = "rgb(235, 80, 100)";
dusk.scrollbarColor = "rgba(215, 210, 235, 0.12)";
dusk.preferredEditorTheme = "tokyoNight";

const carbon = createBuiltInTheme("Carbon");
carbon.darkenedPrimaryColor = "rgb(14, 14, 16)";
carbon.primaryColor = "rgb(22, 22, 24)";
carbon.primaryTextColor = "rgb(235, 235, 240)";
carbon.secondaryColor = "rgb(32, 32, 35)";
carbon.secondaryTextColor = "rgb(155, 155, 165)";
carbon.activeColor = "rgb(55, 142, 240)";
carbon.linkTextColor = "rgb(85, 165, 255)";
carbon.borderColor = "rgba(255, 255, 255, 0.08)";
carbon.popupIconColor = "rgb(235, 235, 240)";
carbon.popupBackgroundColor = "rgb(28, 28, 31)";
carbon.popupTextColor = "rgb(235, 235, 240)";
carbon.popupActiveColor = "rgb(55, 142, 240)";
carbon.buttonBackgroundColor = "rgb(55, 142, 240)";
carbon.buttonTextColor = "rgb(255, 255, 255)";
carbon.buttonActiveColor = "rgb(38, 118, 210)";
carbon.boxShadowColor = "rgba(0, 0, 0, 0.5)";
carbon.activeTextColor = "rgb(255, 255, 255)";
carbon.errorTextColor = "rgb(255, 140, 100)";
carbon.dangerColor = "rgb(235, 70, 60)";
carbon.scrollbarColor = "rgba(255, 255, 255, 0.1)";
carbon.preferredEditorTheme = "one_dark";

const mint = createBuiltInTheme("Mint", "light");
mint.darkenedPrimaryColor = "rgb(235, 245, 240)";
mint.primaryColor = "rgb(250, 253, 252)";
mint.primaryTextColor = "rgb(28, 42, 38)";
mint.secondaryColor = "rgb(240, 248, 245)";
mint.secondaryTextColor = "rgb(72, 92, 85)";
mint.activeColor = "rgb(4, 120, 87)";
mint.linkTextColor = "rgb(2, 100, 72)";
mint.borderColor = "rgb(209, 233, 225)";
mint.popupIconColor = "rgb(28, 42, 38)";
mint.popupBackgroundColor = "rgb(250, 253, 252)";
mint.popupTextColor = "rgb(28, 42, 38)";
mint.popupActiveColor = "rgb(4, 120, 87)";
mint.buttonBackgroundColor = "rgb(4, 120, 87)";
mint.buttonTextColor = "rgb(255, 255, 255)";
mint.buttonActiveColor = "rgb(2, 100, 72)";
mint.boxShadowColor = "rgba(0, 0, 0, 0.06)";
mint.activeTextColor = "rgb(255, 255, 255)";
mint.errorTextColor = "rgb(190, 40, 40)";
mint.dangerColor = "rgb(220, 38, 38)";
mint.scrollbarColor = "rgba(28, 42, 38, 0.12)";
mint.preferredEditorTheme = "noctisLilac";

const sandstone = createBuiltInTheme("Sandstone", "light");
sandstone.darkenedPrimaryColor = "rgb(238, 230, 218)";
sandstone.primaryColor = "rgb(252, 248, 242)";
sandstone.primaryTextColor = "rgb(60, 45, 35)";
sandstone.secondaryColor = "rgb(244, 238, 228)";
sandstone.secondaryTextColor = "rgb(110, 90, 70)";
sandstone.activeColor = "rgb(192, 92, 52)";
sandstone.linkTextColor = "rgb(175, 75, 40)";
sandstone.borderColor = "rgb(222, 210, 195)";
sandstone.popupIconColor = "rgb(60, 45, 35)";
sandstone.popupBackgroundColor = "rgb(252, 248, 242)";
sandstone.popupTextColor = "rgb(60, 45, 35)";
sandstone.popupActiveColor = "rgb(192, 92, 52)";
sandstone.buttonBackgroundColor = "rgb(192, 92, 52)";
sandstone.buttonTextColor = "rgb(255, 255, 255)";
sandstone.buttonActiveColor = "rgb(165, 72, 38)";
sandstone.boxShadowColor = "rgba(0, 0, 0, 0.06)";
sandstone.activeTextColor = "rgb(255, 255, 255)";
sandstone.errorTextColor = "rgb(180, 40, 35)";
sandstone.dangerColor = "rgb(200, 50, 45)";
sandstone.scrollbarColor = "rgba(60, 45, 35, 0.12)";
sandstone.preferredEditorTheme = "noctisLilac";

const blossom = createBuiltInTheme("Blossom", "light");
blossom.darkenedPrimaryColor = "rgb(242, 234, 237)";
blossom.primaryColor = "rgb(254, 250, 251)";
blossom.primaryTextColor = "rgb(48, 38, 42)";
blossom.secondaryColor = "rgb(248, 240, 243)";
blossom.secondaryTextColor = "rgb(100, 80, 88)";
blossom.activeColor = "rgb(190, 75, 115)";
blossom.linkTextColor = "rgb(170, 55, 95)";
blossom.borderColor = "rgb(232, 218, 223)";
blossom.popupIconColor = "rgb(48, 38, 42)";
blossom.popupBackgroundColor = "rgb(254, 250, 251)";
blossom.popupTextColor = "rgb(48, 38, 42)";
blossom.popupActiveColor = "rgb(190, 75, 115)";
blossom.buttonBackgroundColor = "rgb(190, 75, 115)";
blossom.buttonTextColor = "rgb(255, 255, 255)";
blossom.buttonActiveColor = "rgb(160, 55, 95)";
blossom.boxShadowColor = "rgba(0, 0, 0, 0.06)";
blossom.activeTextColor = "rgb(255, 255, 255)";
blossom.errorTextColor = "rgb(200, 45, 40)";
blossom.dangerColor = "rgb(210, 50, 45)";
blossom.scrollbarColor = "rgba(48, 38, 42, 0.12)";
blossom.preferredEditorTheme = "noctisLilac";

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
	obsidian,
	ember,
	dusk,
	carbon,
	mint,
	sandstone,
	blossom,
	custom,
];
