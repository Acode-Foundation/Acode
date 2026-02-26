import actions from "../handlers/quickTools";
import appSettings from "../lib/settings";
import themes from "../theme/list";
import constants from "./constants";
import fonts from "./fonts";

export default {
	beforeRender() {
		//animation
		appSettings.applyAnimationSetting();

		//full-screen
		if (appSettings.value.fullscreen) {
			acode.exec("enable-fullscreen");
		}

		//setup vibration
		app.addEventListener("click", function (e) {
			const $target = e.target;
			if ($target.hasAttribute("vibrate") && appSettings.value.vibrateOnTap) {
				navigator.vibrate(constants.VIBRATION_TIME);
			}
		});

		system.setInputType(appSettings.value.keyboardMode);
		// Keep native context menu enabled globally; editor manager scopes disabling to CodeMirror focus.
		system.setNativeContextMenuDisabled(false);
	},
	afterRender() {
		const { value: settings } = appSettings;
		if (!settings.floatingButton) {
			root.classList.add("hide-floating-button");
		}

		actions("set-height", settings.quickTools);
		fonts.setFont(settings.editorFont);
		if (!themes.applied) {
			themes.apply("dark");
		}
	},
};
