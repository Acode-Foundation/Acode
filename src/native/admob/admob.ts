import channel from "../channel";
import exec from "../exec";
import bridge from "../runtime";
import { MobileAd } from "./ads/base";
import { type NativeAction, NativeService } from "./common";
import { AdMob } from "./index";

const admob = new AdMob();

function onMessageFromNative(event: any) {
	const { data } = event;
	if (data?.adId) {
		data.ad = MobileAd.getAdById(data.adId);
	}
	bridge.fireDocumentEvent(event.type, data);
}

const feature = "onAdMobPlusReady";
channel.createSticky(feature);
channel.waitForInitialization(feature);

channel.onBridgeReady.subscribe(() => {
	const action: NativeAction = "ready";
	exec(onMessageFromNative, console.error, NativeService, action, []);
	channel.initializationComplete(feature);
});

export default admob;
