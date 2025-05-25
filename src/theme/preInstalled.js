import appSettings from "lib/settings";
import { isDeviceDarkTheme } from "lib/systemConfiguration";
import { createBuiltInTheme } from "./builder";
import { apply } from "./list";

const WHITE = "rgb(255, 255, 255)";
const BLACK = "rgb(0, 0, 0)";

const dark = createBuiltInTheme("Dark", "dark", "free");
dark.primaryColor = "rgb(49, 49, 49)";
dark.primaryTextColor = WHITE;
dark.darkenedPrimaryColor = "rgb(29, 29, 29)";
dark.secondaryColor = "rgb(37, 37, 37)";
dark.secondaryTextColor = WHITE;
dark.activeColor = "rgb(51, 153, 255)";
dark.linkTextColor = "rgb(181, 180, 233)";
dark.borderColor = "rgba(230, 230, 230, 0.2)";
dark.popupIconColor = WHITE;
dark.popupBackgroundColor = "rgb(49, 49, 49)";
dark.popupTextColor = WHITE;
dark.popupActiveColor = "rgb(255, 215, 0)";

const oled = createBuiltInTheme("OLED");
oled.primaryColor = "rgb(0, 0, 0)";
oled.primaryTextColor = WHITE;
oled.darkenedPrimaryColor = "rgb(0, 0, 0)";
oled.secondaryColor = "rgb(0, 0, 0)";
oled.secondaryTextColor = WHITE;
oled.activeColor = "rgb(56, 56, 56)";
oled.activeIconColor = "rgba(255, 255, 255, 0.2)";
oled.linkTextColor = "rgb(181, 180, 233)";
oled.borderColor = "rgb(124, 124, 124)";
oled.popupIconColor = WHITE;
oled.popupBackgroundColor = "rgb(0, 0, 0)";
oled.popupTextColor = WHITE;
oled.popupActiveColor = "rgb(121, 103, 0)";
oled.popupBorderColor = "rgba(255, 255, 255, 0.4)";
oled.boxShadowColor = BLACK;

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

const light = createBuiltInTheme("Light", "light");
light.darkenedPrimaryColor = "rgb(153, 153, 153)";
light.primaryColor = WHITE;
light.primaryTextColor = "rgb(51, 62, 89)";
light.secondaryColor = WHITE;
light.secondaryTextColor = "rgb(51, 62, 89)";
light.activeColor = "rgb(51, 153, 255)";
light.linkTextColor = "rgb(104, 103, 149)";
light.borderColor = "rgb(153, 153, 153)";
light.popupIconColor = "rgb(51, 62, 89)";

const system = createBuiltInTheme("System");

export function updateSystemTheme(darkTheme) {
	if (darkTheme) {
		system.primaryColor = "rgb(49, 49, 49)";
		system.primaryTextColor = WHITE;
		system.darkenedPrimaryColor = "rgb(29, 29, 29)";
		system.secondaryColor = "rgb(37, 37, 37)";
		system.secondaryTextColor = WHITE;
		system.activeColor = "rgb(51, 153, 255)";
		system.linkTextColor = "rgb(181, 180, 233)";
		system.borderColor = "rgba(230, 230, 230, 0.2)";
		system.popupIconColor = WHITE;

		system.preferredEditorTheme = "ace/theme/clouds_midnight";

		system.popupBackgroundColor = "rgb(49, 49, 49)";
		system.popupTextColor = WHITE;
		system.popupActiveColor = "rgb(255, 215, 0)";
	} else {
		system.darkenedPrimaryColor = "rgb(153, 153, 153)";
		system.primaryColor = WHITE;
		system.primaryTextColor = "rgb(51, 62, 89)";
		system.secondaryColor = WHITE;
		system.secondaryTextColor = "rgb(51, 62, 89)";
		system.activeColor = "rgb(51, 153, 255)";
		system.linkTextColor = "rgb(104, 103, 149)";
		system.borderColor = "rgb(153, 153, 153)";
		system.popupIconColor = "rgb(51, 62, 89)";

		system.preferredEditorTheme = "ace/theme/crimson_editor";
	}

	if (appSettings.value.appTheme.toLowerCase() === "system") {
		apply(system.id, true);
	}
}

updateSystemTheme(await isDeviceDarkTheme());

const custom = createBuiltInTheme("Custom");
custom.autoDarkened = true;

export default [
	createBuiltInTheme("default", "dark", "free"),
	system,
	dark,
	oled,
	ocean,
	bump,
	bling,
	moon,
	atticus,
	tomyris,
	menes,
	light,
	custom,
];
