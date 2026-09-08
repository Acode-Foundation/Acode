import toast from "components/toast";
import confirm from "dialogs/confirm";
import helpers from "utils/helpers";
import adRewards from "./adRewards";
import { APP_ICONS } from "./appIcons";
import config from "./config";
import { requestProPurchase } from "./removeAds";
import showRewardedAd from "./rewardedAd";
import appSettings from "./settings";

// Also exclude a newly opened picker while an earlier native change is pending.
let selecting = false;

export default function createAppIconSelection({ signal, onBusy, onChange }) {
	return async function selectIcon(iconId) {
		const icon = APP_ICONS.find(({ id }) => id === iconId);
		if (!icon || selecting || signal.aborted) return;
		if (iconId === (appSettings.value.appIcon || "default")) return;

		selecting = true;
		onBusy(true);
		try {
			if (icon.requiresPro && !config.HAS_PRO) {
				await requestProPurchase({ signal });
				return;
			}
			if (iconId !== "default" && adRewards.canShowAds()) {
				const confirmed = await confirm(
					strings["app icon"],
					strings["confirm app icon reward"],
					false,
					{ signal },
				);
				if (!confirmed || signal.aborted) return;
				// Pro or a pass may have become active while confirmation was open.
				if (adRewards.canShowAds()) {
					const earned = await showRewardedAd({ signal });
					if (signal.aborted) return;
					if (!earned) {
						toast(strings["rewarded ad incomplete"]);
						return;
					}
				}
			}
			if (signal.aborted || (icon.requiresPro && !config.HAS_PRO)) return;
			await helpers.promisify(system.setAppIcon, iconId);
			// Once Android has applied the change, keep persisted state in sync
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
			if (!signal.aborted) onBusy(false);
		}
	};
}
