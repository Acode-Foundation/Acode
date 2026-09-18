# Acode - Code Editor for Android

<p align="center">
  <img src='res/logo_1.png' width='250'>
</p>

[![](https://img.shields.io/endpoint?logo=telegram&label=Acode&style=flat&url=https%3A%2F%2Facode.app%2Fapi%2Ftelegram-members-count)](https://t.me/foxdebug_acode) [![](https://dcbadge.vercel.app/api/server/vVxVWYUAWD?style=flat)](https://discord.gg/vVxVWYUAWD)

## • Overview

Welcome to Acode Editor - a powerful and versatile code editing tool designed specifically for Android devices. Whether you're working on HTML, CSS, JavaScript, or other programming languages, Acode empowers you to code on-the-go with confidence. Under the hood it runs on Cordova with a CodeMirror 6 editor engine (exposed to plugins through an Ace-compatible API layer), and it ships as two editions from one codebase - free and Pro (unlocked via in-app purchase) - with a separate F-Droid build that strips out proprietary dependencies.

## • Features

**Editor core**
- CodeMirror 6-based editor with syntax highlighting for 100+ programming and markup languages
- Dozens of built-in colour themes, plus a font manager for installing and using custom fonts
- Command Palette (`Ctrl+Shift+P`) and full keyboard-shortcut support (`Ctrl+S` to save, and more) for external/Bluetooth keyboards
- Fast fuzzy file finder (`Ctrl+P`) with startup file caching for instant results, even in large projects
- Search & replace across every file in a project, not just the open one
- Customizable Quick Tools row above the keyboard
- Local word completion - autocomplete suggestions drawn from the current file
- Rename, move, and manage files directly from the in-app file browser

**Preview & debugging**
- Edit and create websites, and instantly preview them in a browser
- In-app Markdown preview
- Built-in JavaScript console

**Terminal & servers**
- Built-in terminal (Alpine) with its own terminal service that can keep running in the background, independent of the app's lifecycle
- Multiple terminal tabs, `/initrc` support for custom shell startup, and pre-installed CLI tools such as `fd`, `rg` (ripgrep), `fzf`, and `jq`
- S/FTP and SSH terminal integration, including ED25519 key support, with resilient connection handling for stalled connections

**Connectivity & sync**
- Acode account for restoring purchase entitlement across devices
- Manual settings backup and restore

**Extensibility**
- Enjoy a large collection of community plugins, backed by a first-party Plugin Store - 30+ plugins and growing, each showing version and last-updated info
- Plugin API that exposes editor internals so plugins can extend the editor deeply
- Multi-language editing support with easy management tools

**Everything else**
- System-theme-aware UI (follows your device's light/dark setting)
- In-app sponsor page for supporting development
- Nightly builds published automatically via CI for the newest fixes ahead of stable releases

## • Installation

You can get Acode Editor from popular platforms:

[<img src="https://play.google.com/intl/en_us/badges/images/generic/en-play-badge.png" alt="Get it on Google Play" height="60">](https://play.google.com/store/apps/details?id=com.foxdebug.acodefree) [<img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png" alt="Get it on F-Droid" height="60"/>](https://www.f-droid.org/packages/com.foxdebug.acode/)

You can also grab manual APKs, including automated nightly pre-releases, from [GitHub Releases](https://github.com/Acode-Foundation/Acode/releases).

## • Project Structure

<pre>
Acode/
|
|- .devcontainer/ - Pre-configured dev container for a ready-to-code environment
|
|- .github/       - CI workflows (build, translation checks, nightly releases)
|
|- hooks/         - Cordova build hooks
|
|- src/           - Core code and language files
|
|- www/           - Public documents, compiled files, and HTML templates
|
|- utils/         - CLI tools for building, string manipulation, and more
|
|- tests/         - Test suite
</pre>

## • Build Variants

Acode is built from one codebase into several variants using the project's build script:

```shell
yarn build <free|paid> <p|prod|d|dev> [fdroid] <apk/bundle>
```

- `free` / `paid` - selects the build artifact: the `paid` build unlocks Pro features directly, with no purchase required for that package. An in-app purchase is a separate upgrade path that unlocks Pro inside the `free` package
- `p`/`prod` or `d`/`dev` - production or development build
- `fdroid` (optional flag) - produces the F-Droid-compatible build with proprietary dependencies removed; omit it for the regular Play Store build
- `apk` or `bundle` - output format

See [CONTRIBUTING.md](CONTRIBUTING.md) for full environment setup and build instructions.

## • Multi-language Support

Enhance Acode's capabilities by adding new languages easily. Just create a file with the language code (e.g., en-us for English) in [`src/lang/`](https://github.com/Acode-Foundation/Acode/tree/main/src/lang) and include it in [`src/lib/lang.js`](https://github.com/Acode-Foundation/Acode/blob/main/src/lib/lang.js). Manage strings across languages effortlessly using utility commands:

```shell
pnpm run lang add
pnpm run lang remove
pnpm run lang search
pnpm run lang update
```

Every pull request touching `src/lang/*.json` is automatically checked by CI for structural consistency before it can be merged.

## • Contributing & Building the Application

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed instructions.

## • Contributors

<a href="https://github.com/Acode-Foundation/Acode/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Acode-Foundation/Acode" />
</a>

## • Developing a Plugin for Acode

For comprehensive documentation on creating plugins for Acode Editor, visit the [repository](https://github.com/Acode-Foundation/acode-plugin).

For plugin development information, refer to: [Acode Plugin Documentation](https://docs.acode.app/)

## • Community

- [Telegram](https://t.me/foxdebug_acode)
- [Discord](https://discord.gg/vVxVWYUAWD)
- [GitHub Discussions](https://github.com/Acode-Foundation/Acode/discussions)

## Star History

<a href="https://star-history.com/#Acode-Foundation/Acode&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Acode-Foundation/Acode&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Acode-Foundation/Acode&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Acode-Foundation/Acode&type=Date" />
 </picture>
</a>
