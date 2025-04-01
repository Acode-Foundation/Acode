# Change Log

## v1.11.1 (957)

### Features  
- **Syntax Highlighting**: Added syntax highlighting for code blocks on the plugin page using Ace Editor.  
- **Theme Settings Fallback**: Implemented a fallback mechanism on the theme settings page when a custom tab is opened.  
- **QuickTools Scroll Wheel Support**: Added support for scroll wheel events in QuickTools when in click mode.  
- **SFTP Improvements**:  
  - Enhanced logging for better debugging.  
  - Enabled Bouncy Castle for SFTP, resolving connection issues with certain key types.  
- **App Update Mechanism**:  
  - Now checks for updates after app startup.  
  - Uses a native approach instead of traditional fetch.  

### Fixes & Improvements  
- **SD Card Plugin**: Handled a few edge cases to prevent crashes.  
- **GitHub Plugin Palette Fix**: Resolved an issue where the color palette was breaking the GitHub plugin.  
- **Plugin Installation Fixes**:  
  - Updated the install button in the sidebar to prevent multiple installations.  
  - Fixed the installation mechanism in both the sidebar and the `installPlugin` API.  
- **Quality of Life Enhancements**:  
  - Various small improvements when installing/uninstalling plugins from the sidebar.  

#### ⚠️ Experimental Changes ⚠️  
- **Improved Plugin Loading**:  
  - Only **theme plugins** load on Acode startup for faster performance.  
  - All other plugins load **after** Acode startup.  
- **Important for Theme Developers**:  
  - Ensure your **plugin ID includes the word "theme"** to be correctly recognized as a theme plugin.  
  - No changes are needed for existing theme plugins.  
- **Potential Issues**: Since this is an experimental change, some features may break. Please report any issues encountered.

## v1.11.0 (956)

### Fixes
* Fixed a typo: "vission" → "vision" by @ByteJoseph in #1125
* Fixed heading and image alignment issues with `alignment="center"` on the plugin page by @bajrangCoder in #1132
* Fixed file listing in SFTP by @bajrangCoder in #1133
* Fixed fallback to `*/*` when the `accept` attribute is absent in `<input type="file">` in the in-app browser by @bajrangCoder in #1154
* Fixed console not reappearing after page reload in the in-app browser by @bajrangCoder in #1155
* Fixed infinite scroll on the plugin page to remove duplicates by @bajrangCoder in #1171
* Fixed logger to limit its size in #1167
* Fixed an issue where the info dialog wouldn't appear for non-editor tabs in #1167
* Fixed incorrect file attributes in FTP by @bajrangCoder in #1194
* Fixed the palette not opening when triggered from an existing palette by @bajrangCoder in #1197
* Fixed trigering of infinite scroll on plugin page while searching by @bajrangCoder in #1200

### Features
* Improved tab view gesture handling to distinguish between scroll and swipe on the plugin page by @bajrangCoder in #1131
* Added color preview for SVG files by @bajrangCoder in #1135
* Implemented custom editor tab support by @bajrangCoder in #1136
  * Now supports image, video, and audio previews directly in the editor instead of pop-ups
  * Exposed API for plugin developers to add content in editor tabs via `EditorFile`
* Redesigned the About page by @bajrangCoder in #1153
* Added a plugin rebuild option for local plugins by @bajrangCoder in #1150
  * Plugins can use `cordova.plugin.http` instead of `fetch` to avoid CORS issues when making network requests
* Redesigned the Plugin page by @bajrangCoder in #1152
  * Added new metadata fields in `plugin.json`: `license`, `changelog`, `keywords`, and `contributors`
* Added a new option to open files in an external app from the file browser in #1163
* Added minor sidebar UI tweaks and improved input element styling in #1164
* Used theme colors in the extra cutout area in landscape mode instead of the default color in #1165
* Improved file info dialog design in #1170
* Added Eruda console support for external sites in Acode's built-in browser in #1172
* Added a new editor setting: **"Fade fold widgets"** by @bajrangCoder in #1195
* Added a command to change the editor and app theme via the command palette by @bajrangCoder in #1197
* Added option to install plugins directly from sidebar extensions app by @bajrangCoder in #1200

### Improvements
* Improved paste operation with proper error handling in #1162
* Rewritten SFTP implementation(#1167):
  * Better performance and stability
  * Improved symlink support with better visual distinction
  * Proper error handling
  * Enhanced file reading (downloading) and writing
  * Uses native APIs for file system operations
  * Better buffer handling—now even 30-40 minute videos load within seconds (faster than internal storage)
  * Emoji support added
* Improved the FTP client (#1193) by @bajrangCoder
  * Supports emoji-named files
  * Improved symlink handling
  * Better handling of videos and images as binary files
  * Displays file names instead of full paths
* Reworked the plugin page UI—now displays essential info such as author, license, price, etc., in the list view by @bajrangCoder in #1196
* Tweaked breadcrumbs in the file browser to follow the app theme in #1167
* Updated the SSH library to `v3.1.2` in #1167
* Removed deprecated APIs in #1167
* Added experimental support for saving native logs in Acode Logger in #1167
* Tweaked the donation page  #1188

### Other Changes
* **Chore**: Updated Ace Editor to `v1.39.0`
  * Added CSV & TSV mode
  * Improved search support for multi-line patterns (`\n`, `\t`)
  * And more—see the Ace Changelog
* Many translation updates for `hu-hu` by @summoner

## v1.10.7 (955)

* Update hu-hu.json by @summoner001 in https://github.com/Acode-Foundation/Acode/pull/1092
* build(deps): bump path-to-regexp and express by @dependabot in https://github.com/Acode-Foundation/Acode/pull/1093
* Update hu-hu.json by @summoner001 in https://github.com/Acode-Foundation/Acode/pull/1094
* Exclude python `venv` and php `vendor` folders to speedup startup by @Jobians in https://github.com/Acode-Foundation/Acode/pull/1096
* Update de-de.json to 1.10.6.954 by @Micha-he in https://github.com/Acode-Foundation/Acode/pull/1097
* Update pl-pl.json by @andrewczm in https://github.com/Acode-Foundation/Acode/pull/1099
* minor fixes and tweaks by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1103
  * Added new command(file explorer) to open file manager
  * Added copy button to code blocks on plugin page
  * some error logging for debugging
  * few markdown tweaks
* Updating Brazilian Portuguese language  by @sebastianjnuwu in https://github.com/Acode-Foundation/Acode/pull/1102
* add className by @NezitX in https://github.com/Acode-Foundation/Acode/pull/1104
* Add monochrome icon by @Npepperlinux in https://github.com/Acode-Foundation/Acode/pull/1108
* fix: issue while making request to any ipv4, etc from app by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1107
* Update zh-cn.json and zh-hant.json by @LaunchLee in https://github.com/Acode-Foundation/Acode/pull/1109
* fix: show "No matches found" when palette has no matching items by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1110
* build(deps): bump systeminformation from 5.21.8 to 5.23.14 by @dependabot in https://github.com/Acode-Foundation/Acode/pull/1111
* Follow up for #1110 by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1112
* fix: cleanup plugin install state on failed installations by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1113
* feat: implement infinite scroll for plugin list by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1114
* feat: add quick install button for plugins in sidebar by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1115
* Plugin Dependencies by @alMukaafih in https://github.com/Acode-Foundation/Acode/pull/1030
* updated install state to reflect fs behaviour of android by @alMukaafih in https://github.com/Acode-Foundation/Acode/pull/1118
* fix: clean broken or half installed plugins on start by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1121
* few improvements by @bajrangCoder in https://github.com/Acode-Foundation/Acode/pull/1122

## v1.10.6 (954)

### New Features
- **Install State for Plugins**: Added an install state to improve plugin updates (#1026) by @alMukaafih, further enhanced by @bajrangCoder.
- **Selection Mode in File Browser**: Introduced a selection mode in the file browser by @bajrangCoder.
- **Persistent Notification System**: Added a persistent notification system with toast notifications by @bajrangCoder.
- **In-App Browser Command**: Added a command to open an in-app browser with a given URL by @angeloyana.
- **Font Size Shortcut Keys**: Added new key shortcuts for changing font size by @bajrangCoder:
    - Increase Font Size: `Ctrl - +` or `Ctrl - =`
    - Decrease Font Size: `Ctrl + -` or `Ctrl - _`
- **Command Palette Enhancements**:
    - "Open Plugin Page" command for quick access to plugin pages, especially for keyboard users.
    - "Copy Device Info" command to share device information for troubleshooting.
- **GitHub Alert Support**: Added GitHub alert support in plugin descriptions by @bajrangCoder.
- **File Tab Drop Behavior**: Dropping a file tab into any input or editor now inserts its path by @bajrangCoder.
- **File Browser Context Menu**: Added a "Copy URI" option in the file browser context menu by @bajrangCoder.
- **Project Import as ZIP**: Added the option to import projects as ZIP files by @bajrangCoder.
- **Backup Plugins**: You can now back up plugins, whether they are paid or free by @bajrangCoder.
- **Task List Markdown Support**: Added support for task lists (`- [x]`) in the plugin page markdown by @bajrangCoder.
- **Install as Plugin for ZIP Files**: Added the "Install as Plugin" option in the sidebar files section for ZIP files containing a `plugin.json` in the root directory by @bajrangCoder.
- **`acode.installPlugin` API**: Introduced an API for plugins to install other plugins with user consent by @bajrangCoder(available from versionCode: `954`).
- **View Changelogs in Settings**: Added an option in the settings page to view changelogs directly inside the app by @bajrangCoder.
- **App Update Checker**: Implemented an app update checker that runs on startup by @bajrangCoder.
- feat: copy/cut current line when selection is empty with same key shortcut by @angeloyana
- feat: add symlinks support in SFTP by @bajrangCoder

### Fixes
- **Plugin Loading Failures**: Improved handling of plugin loading failures by @bajrangCoder:
    - Prevents the app from crashing when plugins fail to load.
    - Shows user feedback for each failed plugin while continuing to load others.
- **Internal URL Navigation**: Replaced browser navigation with scroll behavior for internal links in plugin descriptions. Links to the same markdown now scroll instead of opening a browser by @bajrangCoder.
- **Pro Version Ads Issue**: Fixed an issue where plugin context menu actions displayed ads even if the Pro version was purchased by @UnschooledGamer.
- **Termux Private URI Operations**: Resolved issues with deleting folders/files and renaming files in Termux private URI file systems.
- **Logger Enhancements**: Improved the logger to automatically detect failures and use `console.error` in Acode.
- **Preview and Server Port Issue**: Fixed an issue where the browser did not open on the given port when the preview port and server port differed.
- **Font Persistence**: Resolved an issue where fonts did not persist after restarting the app.
- **Markdown Linking**: Fixed issues with linking to headings within the same page in markdown.
- **Search Bar in File Browser**: Fixed a bug where the search bar in the file browser would get stuck and become unclosable.
- **Theme Page Issues**: Addressed issues with theme plugins, including preview rendering and checkbox state changes.
- **Formatter Mode Selection**: Fixed the formatter ignoring the selected mode for files by @alMukaafih.
- fix: fetch plugin updates even if any fails by @UnschooledGamer
- fix: plugin update page by removing unwanted option icon @bajrangCoder

### Others
- **Plugin Refactor**: Migrated the old plugin update icon to a new toast-like notification widget.

### Translators
- Updated translations for specific languages contributed by:
    - **@Micha-he**: `de-de.json`
    - **@LaunchLee**: `zh-cn.json` and `zh-hant.json`
    - **@andrewczm**: `pl-pl.json`
    - **@Nekitori17**: `vi-vn`
    - **@s4ntiksu**: `ru-ru.json`
    - **@summoner001**: `hu-hu.json`
    - **@antikruk**: `be-by.json`

---

## [1.10.5] (953)

- New
  - Plugin Filtering System in #1011
  - feat: Add more action menu in sidebar plugin in #1017
  - Implement Logger system in #1020
  - Feat: Use Current File for preview (Toggle option) in #1006
  - updated ace editor to v1.36.2 in #1025

- Fixes
  - Update de-de.json in #1039
  - fixed sidebar plugin search list scrolling in #1002
  - Improve zh-TW traditional Chinese translation in #1004
  - fix: Fixed save all changes option in #1010
  - chore(i18n): vi-vn in #1016
  - removed auto paste of url on plugin page in #1023
  - fixed weird spacing issue on header #925 in #1024
  - Update zh-cn.json and zh-hant.json in #1031
  - Refactor Iap.java: Use WeakReference for Context and Activity to prevent memory leaks in #1040
  - Updated Polish translation in #1043
  - ru-ru improved in #1041
  - Update pl-pl.json in #1044 & #1045
  - fix: termux related fs operations failure in #1046

## [1.10.4] (952)

- New
  - Nested Files/Folder Creation
  - Updated ace to latest version
  - Improved displaying of Download count on Plugins page as well as on Sidebar
  - Enhanced search functionality to allow searching across all available plugins from the "all" section of the plugin page.
  - Added a new option on Help page for submitting bug reports.
- Fixes
  - Fixed issue with the search bar on the plugin page
  - Fixed issue with the search bar closing accidentally when clicking elsewhere on the screen

## [1.10.2]

- New
  - [x] **Updated Ace editor** | 947
    - Updated Ace editor to version 1.33.1.

## [1.10.1]

- New
  - [x] **Updated Ace editor** | 946
    - Updated Ace editor to version 1.32.9
- Fixes
  - [x] **Scrolling** | 946
    - Fixed scrollbars not showing up properly.

## [1.10.0]

- New
  - [x] **Ace editor** | 937
    - Updated Ace editor to version 1.32.7
- Fixes
  - [x] **UI** | 944
    - Fixed status and navigation text color not visible in light theme.
  - [x] **Plugin** | 944
    - Fixed updates for plugin not showing up.
  - [x] **Markdown** | 945
    - Fixed markdown preview not working properly.
  - [x] **Text selection** | 937
    - Fixed context menu not showing up when selecting all text from context menu after click and hold.

## [1.9.0]

- New
  - [x] **New in app browser** | 324
    - New in app browser with new UI.
    - You can emulate multiple devices.
  - [x] **New mode** | 933
    - Zig mode
    - Astro mode
- Fixes
  - [x] **File** | 931
    - Fixed not able share, edit or open with other apps.
    - Fixed file rename not working properly. | 934
  - [x] **Preview** | 934
    - Fixed preview where it opens browser two times.

## [1.8.8]

- New
  - [x] **Natural Scrolling** | 331
    - Acode now uses natural scrolling.
- Fixes
  - [x] **Selecting text** | 331
    - Fixed an issue where selecting text using long press and adding text to selection behaves unexpectedly.
  - [x] **Open folders** | 331
    - Fixed an issue where removing folder from sidebar doesn't remove the selected folder.

## [1.8.7]

- New
  - [x] **Updated Ace editor** | 318
    - Updated Ace editor to version 1.28.0
  - [x] **New problems page** | 318
    - You can now see all the problems in one place.
    - You can also see the problems in opened file.
  - [x] **New settings** | 318
    - New settings to toggle side buttons.
  - [x] **New Plugin API** | 318
    - `SideButton` is a new component that can be used to add side buttons.
  - [x] **New theme color** | 318
    - New `danger-color` and `danger-text-color` theme color.
  - [x] **New key binding** | 318
    - Use `Ctrl+Shift+X` key binding to open problems page.
  - [x] **Plugin** | 320
    - Install plugin directly from browser.
  - [x] **Intent** | 323
    - Plugin has now API to handle intent with uri acode://module/action/value.
- Fixes
  - [x] **Plugin page** | 318
    - Improved plugin page UI.
    - Shows plugin quickly when opened and loads new information in background.
  - [x] **Unsaved changes** | 318
    - Fixed unsaved changes not showing up in file when app restarted.
  - [x] **Quicktools** | 319
    - Fixed quicktools slides back when touch moved slightly.
  - [x] **Settings** | 321
    - Fixed settings not saving properly.
  - [x] **Internal storage** | 322
    - Fixed renaming file.
  - [x] **Side buttons** | 323
    - Fixed side buttons not shown properly.
  - [x] **Open folders** | 330
    - Fixed move file/folder not working properly.
  - [x] **Editor** | 330
    - Improved scrolling.
  - [x] **Quicktools** | 330
    - Improved quicktools.

## [1.8.6] - Build 313

- New
  - [x] **Search in settings**
    - You can now search for any settings in settings page.
- Updates
  - [x] **Language**
    - Updated language pack for Russian, Spanish, Portuguese and Deutsche.
  - [x] **Updated Ace editor**
    - Updated Ace editor to version 1.5.0
- Fixes
  - [x] **Sidebar search**
    - Fixed sidebar search not rendering words with special characters.
  - [x] **Not Loading**
    - Fixed app not loading on older devices.
  - [x] **Scrolling**
    - Fixed scrolling not working properly on some devices.
  - [x] **Eruda console**
    - Fixed eruda console not working properly.
  - [x] **Scrollbar**
    - Fixed scrollbar not working properly.
  - [x] **Custom theme**
    - Fixed custom theme not working properly.

## [1.8.5] - Build 295

- New
  - [x] **Scroll speed**
    - New 'Fast x2' scroll speed.
  - [x] **Touch handling**
    - Prevent accidental touch when tapping tear drop.
  - [x] **Color Preview**
    - You can now see color preview in css, scss, less, stylus and sass codes.
    - No need to select the whole color.
    - Enable/disable this feature from editor settings.
  - [x] **Smaller app size**
    - Reduced app size.
  - [x] **Updated icon pack**
    - Updated icon pack (mono color).
  - [x] **Default file encoding**
    - You can set default file encoding from settings.
  - [x] **File encoding**
    - Remember file encoding for each file.
  - [x] **Sidebar apps**
    - File list and extension list now remembers scroll position.
  - [x] **File tab bar**
    - When repositioning file tab bar, tab container will scroll when current tab is at the edge.
- Fixes
  - [x] **Touch handling**
    - Fixed teardrop and text menu not updated when switching tabs.
  - [x] **File encoding**
    - Fixed file encoding not working properly.
  - [x] **File icon**
    - Fixed inconsistent file icon.
  - [x] **JavaScript console**
    - Fixed JavaScript console not opening.
  - [x] **Ads**
    - Fixed ads taking screen when keyboard is open.
  - [x] **Insert file**
    - Fixed 'insert file' in opened folder not working properly.

## [1.8.4] - Build 283

- New
  - [x] **Updated Ace editor**
    - Updated Ace editor to version 1.22.0
  - [x] **Open files position**
    - **Bottom** `beta`: This is new option for open files position. You can change
      this from settings. This will open files in bottom of the screen.
  - [x] **Search in All Files** `beta`
    - This feature can be used to search and replace in all files in the opened projects.
    - To use this feature, open side bar and click on the search icon.
    - Note: This feature is in beta, so it may not work as expected.
  - [x] **Fast File Listing in Find Files (Ctrl + P)**
    - Loads files at startup and caches them for faster loading.
    - Watches file being created or modified from sidebar and updates the list
      accordingly.
  - [x] **Ctrl Key Functionality**
    - Keyboard shortcuts:
      - Ctrl+S: Save
      - Ctrl+Shift+P: Open the command palette. (Your shortcut may be different
        depending on what is saved in .keybindings.json file.)
  - [x] **Plugin API**
    - `contextMenu` is a component that can be used to show context menu in your plugin page.
  - [x] **Customisable quick tools**
    - You can now customise quick tools from settings.
- Fixes
  - [x] **Scrolling Issue**
    - Resolved an issue causing automatic scrolling from the cursor's
      position when the back button is pressed with the soft keyboard up.
    - Fixed a bug where scrollbar gets visible even when the file is not
      scrollable.
  - [x] **Active files in sidebar**
    - Fixed active files taking whole height of sidebar.
  - [x] **File opened using intent**
    - Fixed file opened using intent is not set as active file.
  - [x] **App doesn't load**
    - Fixed an issue where the app wouldn't load when an error occurred.
  - [x] **File tab bar**
    - Changing file tab bar position will not make editor lose focus.
  - [x] **Sidebar**
    - Fixed sidebar resized unknowingly when dragged to open or close it.
  - [x] **Close all tabs**
    - Fixed "close all" action opens up multiple confirm dialog for every unsaved file.
    - Now it will ask what to do with unsaved files.
  - [x] **File changed alert**
    - Fixed file changed alert showing up even when file is not changed.
  - [x] **Explore**
    - Fixed file not opening when opened from Explore.
  - [x] **Extensions app in sidebar**
    - Fixed extensions app's explore not rendering properly.
  - [x] **Minor bugs**
    - Fixed many minor bugs.
    - Improved stability.

## [1.8.3] - Build 278

- [x] Bugs fixes

## [1.8.2] - Build 276

- [x] Updated ace editor to version v1.18.0
- [x] Bugs fixes

## [1.8.1] - Build 274

- [x] Clicking on gutter will go to that line
- [x] Plugin Stability improvement
- [x] Updated ace editor
- [x] Bugs fixes

## [1.8.0] - Build 272

- [x] Plugins can support themes, fonts and sidebar items
- [x] Redesigned sidebar and quicktools
- [x] UI improvements
- [x] Bugs fixes

## [1.7.2] - Build 268

- [x] Added new command to toggle quick tools
- [x] Added back search in quick tools
- [x] Palette will close on ESC key
- [x] Plugin settings UI
- [x] Bugs fixes

## [1.7.1] - Build 266

- [x] Swipe to change tab in plugins page
- [x] Fixed update paid plugin
- [x] Bugs fixes

## [1.7.0] - Build 262

- [x] New medium size teardrop
- [x] Fixed some indic languages rendering
- [x] Fixed selection bug
- [x] Support for paid plugins
- [x] Quick tools improvement
- [x] Settings will have info button, you can see more info about settings
- [x] Updated plugin system
- [x] You can see plugin review and rating
- [x] GitHub is removed from app but, you can still use it from plugin
- [x] Bugs fixes

## [1.7.0] - Build 260

- [x] Quick tools improvement
- [x] Settings will have info button, you can see more info about settings
- [x] Updated plugin system
- [x] You can see plugin review and rating
- [x] GitHub is removed from app but, you can still use it from plugin
- [x] Bugs fixes

## [1.6.1] - Build 245

- [x] Updated plugin CDN

## [1.6.0] - Build 244

- [x] Updated plugin APIs
- [x] Updated text menu
- [x] Install plugin form device
- [x] Updated ace editor

## [1.6.0] - Build 239

- [x] Fixed horizontal scroll bug
- [x] Updated ace editor

## [1.6.0] - Build 235

- [x] Retry FTP/SFTP connection when fail
- [x] Supports plugin
- [x] Updated custom theme settings
- [x] Set custom port for preview in app settings
- [x] New option find file
- [x] Stability improvement
- [x] UI improvement
- [x] Fixed keyboard issues
- [x] Fixed tap hold to select text
- [x] Fixed loading files using FTP/SFTP
- [x] Fixed File checking
- [x] Fixed settings
- [x] Various fixes
