# cordova-plugin-buildinfo

このプラグインは、BuildInfoをグローバルのオブジェクトとして定義します。

BuildInfoは deviceready イベントが発火した時点で有効になっています。

```js
document.addEventListener("deviceready", onDeviceReady, false);

function onDeviceReady() {
	console.log('BuildInfo.baseUrl        =' + BuildInfo.baseUrl);
	console.log('BuildInfo.packageName    =' + BuildInfo.packageName);
	console.log('BuildInfo.basePackageName=' + BuildInfo.basePackageName);
	console.log('BuildInfo.displayName    =' + BuildInfo.displayName);
	console.log('BuildInfo.name           =' + BuildInfo.name);
	console.log('BuildInfo.version        =' + BuildInfo.version);
	console.log('BuildInfo.versionCode    =' + BuildInfo.versionCode);
	console.log('BuildInfo.debug          =' + BuildInfo.debug);
	console.log('BuildInfo.buildType      =' + BuildInfo.buildType);
	console.log('BuildInfo.flavor         =' + BuildInfo.flavor);
	console.log('BuildInfo.buildDate      =' + BuildInfo.buildDate);
	console.log('BuildInfo.installDate    =' + BuildInfo.installDate);
}
```

## インストール

```sh
cordova plugin add cordova-plugin-buildinfo
```

## サポートプラットフォーム

* Android
* iOS
* Windows
* macOS(OS X)
* Browser
* Electron

## プロパティ

- [`BuildInfo.baseUrl`](#BuildInfo.baseUrl)
- [`BuildInfo.packageName`](#BuildInfo.packageName)
- [`BuildInfo.basePackageName`](#BuildInfo.basePackageName)
- [`BuildInfo.displayName`](#BuildInfo.displayName)
- [`BuildInfo.name`](#BuildInfo.name)
- [`BuildInfo.version`](#BuildInfo.version)
- [`BuildInfo.versionCode`](#BuildInfo.versionCode)
- [`BuildInfo.debug`](#BuildInfo.debug)
- [`BuildInfo.buildType`](#BuildInfo.buildType)
- [`BuildInfo.flavor`](#BuildInfo.flavor)
- [`BuildInfo.buildDate`](#BuildInfo.buildDate)
- [`BuildInfo.installDate`](#BuildInfo.installDate)
- [`BuildInfo.windows`](#BuildInfo.windows)
  - [`logo`](#BuildInfo.windows.logo)
  - [`version`](#BuildInfo.windows.version)

### BuildInfo.baseUrl

cordova.js ファイルがあるパスを取得します。  
パスの最後は "/" が付きます。

|Platform|Value|Type|
|--------|-----|----|
|Android|Path|String|
|iOS|Path|String|
|Windows|Path|String|
|macOS(OS X)|Path|String|
|Browser|Path|String|
|Electron|Path|String|

### BuildInfo.packageName

Application IDをpackageNameとして取得します。

|Platform|Value|Type|
|--------|-----|----|
|Android|Package Name|String|
|iOS|Bundle Identifier|String|
|Windows|Identity name|String|
|macOS(OS X)|Bundle Identifier|String|
|Browser|config.xml の widget 要素に設定されている id 属性の値が入ります|String|
|Electron|config.xml の widget 要素に設定されている id 属性の値が入ります|String|


### BuildInfo.basePackageName

Androidのみ。

BuildConfigクラスのpackageNameを取得します。

ビルドタイプやFlavorを利用すると、config.xmlのwidget要素で指定したidとは異なるパッケージ名を指定できるため、BuildConfigクラスが属するパッケージ名を取得するためのプロパティです。
(config.xmlのwidget要素にあるid属性と同じになるはずです)


|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfigクラスにあるパッケージ名|String|
|iOS|Bundle Identifier(BuildInfo.packageNameと同一)|String|
|Windows|Identity name(BuildInfo.packageNameと同一)|String|
|macOS(OS X)|Bundle Identifier(BuildInfo.packageNameと同一)|String|
|Browser|BuildInfo.packageName と同一|String|
|Electron|BuildInfo.packageName と同一|String|


### BuildInfo.displayName

アプリのホーム画面での表示名を取得します。

|Platform|Value|Type|
|--------|-----|----|
|Android|Application Label|String|
|iOS|CFBundleDisplayName(存在しない場合はCFBundleName)|String|
|Windows|AppxManifest.xmlのVisualElements要素にあるDisplayName属性|String|
|macOS(OS X)|CFBundleDisplayName(存在しない場合はCFBundleName)|String|
|Browser|config.xml の name 要素の short 属性の値が入ります|String|
|Electron|config.xml の name 要素の short 属性の値が入ります|String|

### BuildInfo.name

アプリの名前を取得します。
(iOSのみ。Androidでは、displayNameと同一になります)

|Platform|Value|Type|
|--------|-----|----|
|Android|Application Label(BuildInfo.displayNameと同一)|String|
|iOS|CFBundleName|String|
|Windows|Windows Store display name|String|
|macOS(OS X)|CFBundleName|String|
|Browser|config.xml の name 要素の内容が入ります|String|
|Electron|config.xml の name 要素の内容が入ります|String|


### BuildInfo.version

バージョンを取得します。

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.VERSION_NAME|String|
|iOS|CFBundleShortVersionString|String|
|Windows|Major.Minor.Build 例) "1.2.3"|String|
|macOS(OS X)|CFBundleShortVersionString|String|
|Browser|config.xml の widget 要素の version 属性の値が入ります|String|
|Electron|config.xml の widget 要素の version 属性の値が入ります|String|


### BuildInfo.versionCode

Version Codeを取得します。
AndroidではINT型で提供されます。

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.VERSION_CODE|int|
|iOS|CFBundleVersion|string|
|Windows|Major.Minor.Build.Revision 例) "1.2.3.4"|String|
|macOS(OS X)|CFBundleVersion|string|
|Browser|BuildInfo.version と同一|String|
|Electron|BuildInfo.version と同一|String|


### BuildInfo.debug

デバッグビルドかどうかを取得します。

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.DEBUG|Boolean|
|iOS|defined "DEBUG" is true|Boolean|
|Windows|isDevelopmentMode is true|Boolean|
|Browser|常に false|Boolean|
|Electron|```cordova build electron --debug``` とした場合 true となります|Boolean|


### BuildInfo.buildType

ビルドタイプを取得します。(AndroidおよびWindowsのみ)

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.BUILD_TYPE|String|
|iOS|empty string|String|
|Windows|"release" or "debug"|String|
|macOS(OS X)|empty string|String|
|Browser|empty string|String|
|Electron|empty string|String|


### BuildInfo.flavor

フレーバーを取得します。(Androidのみ)

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.FLAVOR|String|
|iOS|empty string|String|
|Windows|empty string|String|
|macOS(OS X)|empty string|String|
|Browser|empty string|String|
|Electron|empty string|String|


### BuildInfo.buildDate

Dateオブジェクトとしてビルド日時を取得します。

注意:

- Aandroid: BuildInfo.gradeファイルをAndroidプロジェクトに追加します。  
  BuildInfo.gradeファイルは、BuildConfigクラスに_BUILDINFO_TIMESTAMPというプロパティを追加します。
- Windows: buildinfo.resjsonファイルをWindowsプロジェクトのstringsフォルダに追加します。  
  また、buildinfo.resjsonファイルはCordovaApp.projitemsファイルに追記されたタスクよにりビルド実行時に書き換えられます。
- Browser と Electron: ```cordova prepare``` が実行されたタイミングで  
  platforms/browser/www/plugins/cordova-plugin-buildinfo/src/browser/BuildInfoProxy.js  
  (または platforms/electron/www/plugins/cordova-plugin-buildinfo/src/browser/BuildInfoProxy.js)  
  ファイル内にビルド日時を埋め込みます。  
  ```cordova prepare``` は、```cordova build```、```cordova run```、```cordova platform add```の場合も実行されます。  
  (参照: [Hooks Guide - Apache Cordova](https://cordova.apache.org/docs/en/9.x/guide/appdev/hooks/index.html))

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.\_BUILDINFO\_TIMESTAMP value|Date|
|iOS|メインバンドルのexecutionPathから取得したInfo.plistの更新日時|Date|
|Windows|文字列リソースの "/buildinfo/Timestamp" 値を返します|Date|
|macOS(OS X)|メインバンドルのリソースから取得したconfig.xmlの更新日時|Date|
|Browser|```cordova prepare```が実行された日時|Date|
|Electron|```cordova prepare```が実行された日時|Date|


### BuildInfo.installDate

Dateオブジェクトとしてインストール日時を返します

注意:
- Browser と Electron: インストール日時は不明です。

|Platform|Value|Type|
|--------|-----|----|
|Android|PackageInfoのfirstInstallTimeプロパティ|Date|
|iOS|documentディレクトリの作成日時|Date|
|Windows|Windows.ApplicatinoModel.Package.currentのinstalledDateプロパティ|Date|
|macOS(OS X)|アプリケーションパッケージのFile Metadataに記録されている kMDItemDateAdded の日時|Date|
|Browser|常に null|null|
|Electron|常に null|null|


### BuildInfo.windows

Windowsのみ。

Windowsの追加情報を格納しています。

|Platform|Value|Type|
|--------|-----|----|
|Android|(未定義)|undefined|
|iOS|(未定義)|undefined|
|Windows|Object|Object|
|macOS(OS X)|(未定義)|undefined|
|Browser|(未定義)|undefined|
|Electron|(未定義)|undefined|

|Property name|Value|Type|
|-------------|-----|----|
|architecture|Windows.ApplicationModel.Package.current.id.architecture|integer|
|description|Windows.ApplicationModel.Package.current.description|String|
|displayName|Windows.ApplicationModel.Package.current.displayName|String|
|familyName|Windows.ApplicationModel.Package.current.id.familyName|String|
|fullName|Windows.ApplicationModel.Package.current.id.fullName|String|
|logo|Object|Object|
|publisher|Windows.ApplicationModel.Package.current.id.publisher|String|
|publisherId|Windows.ApplicationModel.Package.current.id.publisherId|String|
|publisherDisplayName|Windows.ApplicationModel.Package.current.publisherDisplayName|String|
|resourceId|Windows.ApplicationModel.Package.current.id.resourceId|String|
|version|Windows.ApplicationModel.Package.current.id.version|Object|

#### BuildInfo.windows.logo

|Property name|Value|Type|
|-------------|-----|----|
|absoluteCannonicalUri|Windows.ApplicationModel.Package.logo.absoluteCanonicalUri|String|
|absoluteUri|Windows.ApplicationModel.Package.logo.absoluteUri|String|
|displayIri|Windows.ApplicationModel.Package.logo.displayIri|String|
|displayUri|Windows.ApplicationModel.Package.logo.displayUri|String|
|path|Windows.ApplicationModel.Package.logo.path|String|
|rawUri|Windows.ApplicationModel.Package.logo.rawUri|String|

#### BuildInfo.windows.version

|Property name|Value|Type|
|-------------|-----|----|
|major|Windows.ApplicationModel.Package.current.id.version.major|integer|
|minor|Windows.ApplicationModel.Package.current.id.version.minor|integer|
|build|Windows.ApplicationModel.Package.current.id.version.build|integer|
|revision|Windows.ApplicationModel.Package.current.id.version.revision|integer|
