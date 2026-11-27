# Acode - Code Editor for Android and iOS

<p align="center">
  <img src='res/logo_1.png' width='250'>
</p>

[![](https://img.shields.io/endpoint?logo=telegram&label=Acode&style=flat&url=https%3A%2F%2Facode.app%2Fapi%2Ftelegram-members-count)](https://t.me/foxdebug_acode) [![](https://dcbadge.limes.pink/api/server/https://discord.gg/vVxVWYUAWD?style=flat)](https://discord.gg/vVxVWYUAWD)

## • Overview

Welcome to Acode Editor - a powerful and versatile code editor for Android phones and tablets, iPhone and iPad. Whether you're working on HTML, CSS, JavaScript, or other programming languages, Acode empowers you to code on-the-go with confidence.

Acode is a web app running in a native WebView shell, with its own native service bridge. Both platforms share the same editor, settings and plugin APIs: Android uses Java/Kotlin native services, and iOS uses Swift native services.

## • Features

- Edit and create websites, and instantly preview them in a browser.
- Seamlessly modify source files for various languages like Python, Java, JavaScript, and more.
- Built-in javascript console
- S/FTP and SSH terminal integration
- Built-in terminal (Alpine Linux) on Android and iOS
- Enjoy multi-language editing support with easy management tools.
- Enjoy a large collections of community plugins to enhance your coding experience.

## • Installation

You can get Acode Editor from popular platforms:

[<img src="https://play.google.com/intl/en_us/badges/images/generic/en-play-badge.png" alt="Get it on Google Play" height="60">](https://play.google.com/store/apps/details?id=com.foxdebug.acodefree) [<img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png" alt="Get it on F-Droid" height="60"/>](https://www.f-droid.org/packages/com.foxdebug.acode/) [<img src="https://upload.wikimedia.org/wikipedia/commons/3/3c/Download_on_the_App_Store_Badge.svg" alt="Download on the App Store" height="40">](https://apps.apple.com/app/id6815644799)

## • Project Structure

<pre>
Acode/
|
|- src/                   - Application source, index.html, language files, and resources
|  |- native/             - TypeScript native APIs and shared bridge
|  |- platforms/          - Android and iOS bridge transports
|
|- platforms/android/     - Native Android app, services, resources, and Gradle wrapper
|- platforms/ios/         - iOS app, native services (runner/lib), terminal runtime, and tests
|
|- tests/                 - Unit tests (Vitest)
|- docs/                  - Platform notes (iOS port, iOS advertising)
|- dev/                   - CLI tools for building, string manipulation, and more
|
|- codemirror-lsp-client/ - Git submodule providing @codemirror/lsp-client (clone with --recurse-submodules)
</pre>

Rspack builds `src/` into `platforms/android/app/src/main/assets/bundle/` or
`platforms/ios/runner/bundle/`. These generated directories are git-ignored and
contain the HTML, static assets, and compiled scripts.

## • Multi-language Support

Enhance Acode's capabilities by adding new languages easily. Just create a file with the language code (e.g., en-us for English) in [`src/lang/`](src/lang/) and include it in [`src/lib/lang.js`](src/lib/lang.js). Manage strings across languages effortlessly using utility commands:

```shell
npm run lang add
npm run lang remove
npm run lang search
npm run lang update
```

## • Contributing & Building the Application

Clone with `--recurse-submodules`, then install dependencies with `npm ci`. Build scripts live in `dev/`.

- **Android:** set `package.json.androidPackageId` to `com.foxdebug.acode` (paid) or `com.foxdebug.acodefree` (free), then run `npm run build -- dev apk`. Paid builds exclude AdMob and its SDKs. Android builds use Java 26, the Gradle 9.8 RC3 wrapper and Android Gradle Plugin 9.4.1.
- **iOS:** copy `platforms/ios/Config.xcconfig.example` to `platforms/ios/Config.xcconfig` on a new checkout and keep only local signing settings in it. Then run `npm run build -- ios dev` for a simulator build, or `npm run dev:ios -- --target=<simulator-UUID>` for live reload. iOS has one free app whose bundle ID comes from `package.json.appleAppId`, built with the `runner` scheme. Version, build number, display name and bundle ID are synced into the Xcode project from `package.json` by `dev/sync.js` on every build.

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed setup, build and test instructions, [docs/ios-port.md](docs/ios-port.md) for iOS platform notes, and [docs/ios-advertising.md](docs/ios-advertising.md) for the iOS advertising setup.

The iOS terminal runs ARM64 Alpine Linux in an emulator behind the same terminal UI and AXS server as Android. See [its runtime sources, build requirements, and compatibility limits](platforms/ios/Alpine/README.md).

## • Contributors

<a href="https://github.com/Acode-Foundation/Acode/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Acode-Foundation/Acode" />
</a>

## • Developing a Plugin for Acode

For comprehensive documentation on creating plugins for Acode Editor, visit the [repository](https://github.com/Acode-Foundation/acode-plugin).

For plugin development information, refer to: [Acode Plugin Documentation](https://docs.acode.app/)

## Star History

<a href="https://star-history.com/#Acode-Foundation/Acode&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Acode-Foundation/Acode&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Acode-Foundation/Acode&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Acode-Foundation/Acode&type=Date" />
 </picture>
</a>
