import * as cordova from "cordova";
import channel from "cordova/channel";
import exec from "cordova/exec";
import { MobileAd } from "./ads/base";
import { type CordovaAction, CordovaService } from "./common";
import { AdMob } from "./index";

const admob = new AdMob();

// biome-ignore lint/suspicious/noExplicitAny: ignore
function onMessageFromNative(event: any) {
  const { data } = event;
  if (data?.adId) {
    data.ad = MobileAd.getAdById(data.adId);
  }
  cordova.fireDocumentEvent(event.type, data);
}

const feature = "onAdMobPlusReady";
channel.createSticky(feature);
channel.waitForInitialization(feature);

channel.onCordovaReady.subscribe(() => {
  const action: CordovaAction = "ready";
  exec(onMessageFromNative, console.error, CordovaService, action, []);
  channel.initializationComplete(feature);
});

export default admob;
