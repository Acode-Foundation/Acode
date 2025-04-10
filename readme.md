# Acode - Code Editor for Android

<p align="center">
  <img src='res/logo_1.png' width='250'>
</p>

[![](https://img.shields.io/endpoint?logo=telegram&label=Acode&style=flat&url=https%3A%2F%2Facode.app%2Fapi%2Ftelegram-members-count)](https://t.me/foxdebug_acode) [![](https://dcbadge.vercel.app/api/server/vVxVWYUAWD?style=flat)](https://discord.gg/vVxVWYUAWD)

## • Overview

Welcome to Acode Editor - a powerful and versatile code editing tool designed specifically for Android devices. Whether you're working on HTML, CSS, JavaScript, or other programming languages, Acode empowers you to code on-the-go with confidence.

## • Features

- Edit and create websites, and instantly preview them in a browser.
- Seamlessly modify source files for various languages like Python, Java, JavaScript, and more.
- Built-in javascript console
- Enjoy multi-language editing support with easy management tools.
- Enjoy a large collections of community plugins to enhance your coding experience.

## • Installation

You can get Acode Editor from popular platforms:

[<img src="https://play.google.com/intl/en_us/badges/images/generic/en-play-badge.png" alt="Get it on Google Play" height="60">](https://play.google.com/store/apps/details?id=com.foxdebug.acodefree) [<img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png" alt="Get it on F-Droid" height="60"/>](https://www.f-droid.org/packages/com.foxdebug.acode/)

## • Project Structure

<pre>
Acode/
|
|- src/   - Core code and language files
|
|- www/   - Public documents, compiled files, and HTML templates
|
|- utils/ - CLI tools for building, string manipulation, and more
</pre>

## • Multi-language Support

Enhance Acode's capabilities by adding new languages easily. Just create a file with the language code (e.g., en-us for English) in [`src/lang/`](https://github.com/Acode-Foundation/Acode/tree/main/src/lang) and include it in [`src/lib/lang.js`](https://github.com/Acode-Foundation/Acode/blob/main/src/lib/lang.js). Manage strings across languages effortlessly using utility commands:

```shell
yarn lang add
yarn lang remove
yarn lang search
yarn lang update
```

## • Building the Application

To build the APK, ensure you have Node.js, NPM, and Apache Cordova installed on your device. Use Cordova CLI to build the application.

1. Initial setup (required only once):

```shell
yarn setup
```

2. Build the project:

```shell
yarn build <platform (android)> <free|paid> <p|prod|d|dev>
```

## • Contributing

Acode Editor is an open-source project, and we welcome contributions from the community. To contribute, follow these steps:

1. Fork the repository.
2. Make your changes and commit them.(make branch for each feature or bug fix)
3. Push your changes to your fork.
4. Create a pull request from your branch to main branch of this repository with proper description and Wait for review.

> [!Note]
> Ensure your pull request includes:
> - A clear description of the changes made or problem or feature.
> - A reference to the issue being addressed (if applicable).
> - A clear explanation of the solution or implementation.
> - Screenshots or GIFs (if applicable).

Please ensure that your code is clean, well-formatted, and follows the project's coding standards. Acode uses [Biomejs](https://biomejs.dev/) for formatting and linting and [typos](https://github.com/crate-ci/typos) for low false positives source code spell checking. You can use following commands to lints/format your code locally:
```shell
yarn lint # for linting
yarn format # for formatting
yarn check # it runs both lint and format
```
Also, ensure that your code is well-documented and includes comments where necessary.

> [!Note]
> You can use any package manager like npm or yarn or pnpm or bun.
> You can use your editor specific Biomejs plugin for auto-formatting and linting based on Acode's configs.

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
