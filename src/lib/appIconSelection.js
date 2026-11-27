import toast from "components/toast";
import confirm from "dialogs/confirm";
import helpers from "utils/helpers";
import adRewards from "./adRewards";
import { APP_ICONS } from "./appIcons";
import config from "./config";
import platform from "./platform";
import { requestProPurchase } from "./removeAds";
import showRewardedAd from "./rewardedAd";
import appSettings from "./settings";

// Also exclude a newly opened picker while an earlier native change is pending.
let selecting = false;

export default async function selectAppIcon(
	iconId,
	{ signal, onBusy, onLoading, onChange },
) {
	const icon = APP_ICONS.find(({ id }) => id === iconId);
	if (!icon || selecting || signal.aborted) return;
	if (iconId === (appSettings.value.appIcon || "default")) return;

	selecting = true;
	onBusy(true);
	try {
		if (!platform.isIOS) {
			// Android launcher changes may restart the app. Warn before checkout.
			const proceed = await confirm(
				strings["app icon"],
				strings["app icon change warning"] ||
					"The app will exit after the app icon is changed.",
				false,
				{ signal },
			);
			if (!proceed || signal.aborted) return;
		}
		if (icon.requiresPro && !config.HAS_PRO) {
			await requestProPurchase({ signal });
			return;
		}
		const needsReward = iconId !== "default" && adRewards.canShowAds();
		if (needsReward) {
			const confirmed = await confirm(
				strings["app icon"],
				strings["confirm app icon reward"],
				false,
				{ signal },
			);
			if (!confirmed || signal.aborted) return;
		}
		onLoading(true);
		// Pro or a pass may have become active while confirmation was open.
		if (needsReward && adRewards.canShowAds()) {
			const earned = await showRewardedAd({ signal });
			if (signal.aborted) return;
			if (!earned) {
				toast(strings["rewarded ad incomplete"]);
				return;
			}
		}
		if (signal.aborted || (icon.requiresPro && !config.HAS_PRO)) return;
		await helpers.promisify(system.setAppIcon, iconId);
		// Once the platform has applied the change, keep persisted state in sync
		// even if the picker closed while the native callback was in flight.
		await appSettings.update({ appIcon: iconId }, false);
		if (!signal.aborted) {
			onChange();
			toast(strings["app icon changed"]);
		}
	} catch (error) {
		if (!signal.aborted) helpers.error(error);
	} finally {
		selecting = false;
		if (!signal.aborted) {
			onLoading(false);
			onBusy(false);
		}
	}
}
