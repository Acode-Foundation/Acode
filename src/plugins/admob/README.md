# [AdMob Plus Cordova](https://admob-plus.github.io)

[![NPM version][b1]][p0]
[![GitHub last commit][b2]][b2-l]
![Dependency status][b3]
[![Package Health][b4]][b4-l]
![Vulnerabilities][b5]
[![NPM license][b6]][b6-l]

AdMob Plus Cordova is the successor of [cordova-plugin-admob-free](https://github.com/ratson/cordova-plugin-admob-free), which provides a cleaner API and build with modern tools.

## Documentation

You can find the documentation [on the website](https://admob-plus.github.io/docs/cordova).

## Features

- App Open Ads
- Banner Ads
- Interstitial Ads
- Rewarded Ads
- Rewarded Interstitial Ads
- Native Ads ([admob-plus-cordova-native](https://www.npmjs.com/package/admob-plus-cordova-native))
- WebView Ads ([admob-plus-cordova-webview-ad](https://www.npmjs.com/package/admob-plus-cordova-webview-ad))
- User Consent ([cordova-plugin-consent](https://www.npmjs.com/package/cordova-plugin-consent))

## Compare to other projects

|              Project              |  No Ad-Sharing  |    Fully Open Sourced     |        No Remote Control        |
| --------------------------------- | --------------- | ------------------------- | ------------------------------- |
| [admob-plus-cordova][p0]          | ✅               | ✅                         | ✅                               |
| [admob][p1]                       | Not Sure        | [❌][p2-bin1] [❌][p2-bin2] | Not Sure                        |
| [cordova-admob][p2]               | [❌][p2-android] | ✅                         | ✅                               |
| [cordova-plugin-ad-admob][p3]     | [❌][p3-android] | ✅                         | ✅                               |
| [cordova-plugin-admob-simple][p4] | [❌][p4-android] | ✅                         | [❌][p4-remote1]                 |
| [cordova-plugin-admobpro][p5]     | [❌][p5-share]   | [❌][p5-bin1] [❌][p5-bin2] | [❌][p5-remote1] [❌][p5-remote2] |
| [cordova-plugin-ads][p6]          | [❌][p6-share]   | ✅                         | ✅                               |

Click ❌ to see the detail.

[p0]: https://www.npmjs.com/package/admob-plus-cordova
[p1]: https://www.npmjs.com/package/admob
[p2]: https://www.npmjs.com/package/cordova-admob
[p2-android]: https://github.com/appfeel/admob-google-cordova/blob/3f122f278a323a4bc9e580f400182a7bd690a346/src/android/AdMobAds.java#L569
[p2-bin1]: https://github.com/admob-google/admob-cordova/blob/master/src/android/libs/admobadplugin.jar
[p2-bin2]: https://github.com/admob-google/admob-cordova/blob/master/src/ios/AdmobAPI.framework/AdmobAPI
[p3]: https://www.npmjs.com/package/cordova-plugin-ad-admob
[p3-android]: https://github.com/cranberrygame/cordova-plugin-ad-admob/blob/7aaa397b19ab63579d6aa68fbf20ffdf795a15fc/src/android/AdMobPlugin.java#L330
[p4]: https://github.com/sunnycupertino/cordova-plugin-admob-simple
[p4-android]: https://github.com/sunnycupertino/cordova-plugin-admob-simple/blob/a58846c1ea14188a4aef44381ccd28ffdcae3bfa/src/android/AdMob.java#L207
[p4-remote1]: https://github.com/sunnycupertino/cordova-plugin-admob-simple/blob/f7cc64e9e018f2146b2735b5ae8d3b780fa24f72/src/android/AdMob.java#L728
[p5]: https://www.npmjs.com/package/cordova-plugin-admobpro
[p5-share]: https://github.com/floatinghotpot/cordova-admob-pro/wiki/License-Agreement#2-win-win-partnership
[p5-bin1]: https://unpkg.com/browse/cordova-plugin-extension@1.6.0/src/android/CordovaAd.jar
[p5-bin2]: https://unpkg.com/browse/cordova-plugin-extension@1.6.0/src/ios/libCordovaAd.a
[p5-remote1]: https://github.com/floatinghotpot/cordova-admob-pro/pull/658
[p5-remote2]: https://github.com/ratson/cordova-plugin-admob-free/issues/354
[p6]: https://www.npmjs.com/package/cordova-plugin-ads
[p6-share]: https://github.com/cozycodegh/cordova-plugin-ads/blob/3d8f14ac02a8a7bad0ab4b472e6b776640f88c15/www/ads.js#L32


## Contributing

- Star this repository
- Open issue for feature requests
- [Sponsor this project](https://admob-plus.github.io/funding)

## Disclaimer

This is third party software, not a product of Google Inc.

Google AdMob is a trademark of Google, Inc.

This plugin utilizes Google AdMob SDKs to provide support for Cordova applications.

## License

AdMob Plus Cordova is [MIT licensed][b6-l].

[b1]: https://img.shields.io/npm/v/admob-plus-cordova.svg
[b2]: https://img.shields.io/github/last-commit/admob-plus/admob-plus
[b2-l]: https://github.com/admob-plus/admob-plus
[b3]: https://img.shields.io/librariesio/release/npm/admob-plus-cordova
[b4]: https://snyk.io/advisor/npm-package/admob-plus-cordova/badge.svg
[b4-l]: https://snyk.io/advisor/npm-package/admob-plus-cordova
[b5]: https://img.shields.io/snyk/vulnerabilities/npm/admob-plus-cordova
[b6]: https://img.shields.io/npm/l/admob-plus-cordova
[b6-l]: https://github.com/admob-plus/admob-plus/blob/master/LICENSE
