[![Build Status](https://travis-ci.org/lynrin/cordova-plugin-buildinfo.svg?branch=master)](https://travis-ci.org/lynrin/cordova-plugin-buildinfo)
[![Code Climate](https://codeclimate.com/github/lynrin/cordova-plugin-buildinfo/badges/gpa.svg)](https://codeclimate.com/github/lynrin/cordova-plugin-buildinfo)
[![MIT License](https://img.shields.io/github/license/lynrin/cordova-plugin-buildinfo)](LICENSE)
[![downloads](https://img.shields.io/npm/dm/cordova-plugin-buildinfo)](https://www.npmjs.com/package/cordova-plugin-buildinfo)


# cordova-plugin-buildinfo

This plugin defines a global BuildInfo object.

BuildInfo object is available at the time the deviceready event fires.

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

## Installation

```sh
cordova plugin add cordova-plugin-buildinfo
```

## Supported Platforms

* Android
* iOS
* Windows
* macOS(OS X)
* Browser
* Electron

## Properties

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

Get the cordova.js file exists path.  
Path last character is '/'.

|Platform|Value|Type|
|--------|-----|----|
|Android|Path|String|
|iOS|Path|String|
|Windows|Path|String|
|macOS(OS X)|Path|String|
|Browser|Path|String|
|Electron|Path|String|

### BuildInfo.packageName

Get the packageName of Application ID.

|Platform|Value|Type|
|--------|-----|----|
|Android|Package Name|String|
|iOS|Bundle Identifier|String|
|Windows|Identity name|String|
|macOS(OS X)|Bundle Identifier|String|
|Browser|Get the id attribute of the widget element in config.xml file.|String|
|Electron|Get the id attribute of the widget element in config.xml file.|String|


### BuildInfo.basePackageName

Android only.

Get the packageName of BuildConfig class.

If you use the configure of "build types" or "product flavors", because you can specify a different package name is the id attribute of the widget element of config.xml, is the property to get the package name that BuildConfig class belongs.
(ought be the same as the id attribute of the widget element of config.xml)


|Platform|Value|Type|
|--------|-----|----|
|Android|Package name of BuildConfig class|String|
|iOS|Bundle Identifier(equals BuildInfo.packageName)|String|
|Windows|Identity name(equals BuildInfo.packageName)|String|
|macOS(OS X)|Bundle Identifier(equals BuildInfo.packageName)|String|
|Browser|equals BuildInfo.packageName|String|
|Electron|equals BuildInfo.packageName|String|


### BuildInfo.displayName

Get the displayName.

|Platform|Value|Type|
|--------|-----|----|
|Android|Application Label|String|
|iOS|CFBundleDisplayName (CFBundleName if not present)|String|
|Windows|Get the DisplayName attribute of the VisualElements element in AppxManifest.xml file.|String|
|macOS(OS X)|CFBundleDisplayName (CFBundleName if not present)|String|
|Browser|Get the short attribute of the name element in config.xml file.|String|
|Electron|Get the short attribute of the name element in config.xml file.|String|

### BuildInfo.name

Get the name.

|Platform|Value|Type|
|--------|-----|----|
|Android|Application Label(equal BuildInfo.displayName)|String|
|iOS|CFBundleName|String|
|Windows|Windows Store display name|String|
|macOS(OS X)|CFBundleName|String|
|Browser|Get value of the name element in config.xml file.|String|
|Electron|Get value of the name element in config.xml file.|String|


### BuildInfo.version

Get the version.

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.VERSION_NAME|String|
|iOS|CFBundleShortVersionString|String|
|Windows|Major.Minor.Build ex) "1.2.3"|String|
|macOS(OS X)|CFBundleShortVersionString|String|
|Browser|Get the version attribute of the widget element in config.xml file.|String|
|Electron|Get the version attribute of the widget element in config.xml file.|String|


### BuildInfo.versionCode

Get the version code.

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.VERSION_CODE|integer|
|iOS|CFBundleVersion|String|
|Windows|Major.Minor.Build.Revision ex) "1.2.3.4"|String|
|macOS(OS X)|CFBundleVersion|String|
|Browser|equals BuildInfo.version|String|
|Electron|equals BuildInfo.version|String|


### BuildInfo.debug

Get the debug flag.

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.DEBUG|Boolean|
|iOS|defined "DEBUG" is true|Boolean|
|Windows|isDevelopmentMode is true|Boolean|
|macOS(OS X)|defined "DEBUG" is true|Boolean|
|Browser|Always false|Boolean|
|Electron|True when ```cordova build electron --debug``` is executed with the "--debug" flag.|Boolean|


### BuildInfo.buildType

Android , Windows Only.

Get the build type.

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.BUILD_TYPE|String|
|iOS|empty string|String|
|Windows|"release" or "debug"|String|
|macOS(OS X)|empty string|String|
|Browser|empty string|String|
|Electron|empty string|String|


### BuildInfo.flavor

Android Only.

Get the flavor.

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.FLAVOR|String|
|iOS|empty string|String|
|Windows|empty string|String|
|macOS(OS X)|empty string|String|
|Browser|empty string|String|
|Electron|empty string|String|

### BuildInfo.buildDate

Get the build date and time in the Date object returns.

Attention:
- Android: Add the BuildInfo.gradle file to your Android project.  
  The BuildInfo.gradle file contains the setting to add the _BUILDINFO_TIMESTAMP field to the BuildConfig class.
- Windows: Add the buildinfo.resjson file to your Windows project.  
  The buildinfo.resjson file into the "strings" folder.  
  And also add a task to rewrite buildinfo.resjson in the CordovaApp.projitems file.
- Browser and Electron: When ```cordova prepare``` is executed Build date and time is embedded in  
  platforms/**browser**/www/plugins/cordova-plugin-buildinfo/src/browser/BuildInfoProxy.js file.  
  (Or platforms/**electron**/www/plugins/cordova-plugin-buildinfo/src/browser/BuildInfoProxy.js file.)  
  ```cordova prepare``` is also executed for ```cordova build```, ```cordova run``` and ```cordova platform add```.  
  (Reference: [Hooks Guide - Apache Cordova](https://cordova.apache.org/docs/en/9.x/guide/appdev/hooks/index.html))

|Platform|Value|Type|
|--------|-----|----|
|Android|BuildConfig.\_BUILDINFO\_TIMESTAMP value|Date|
|iOS|Get the modification date and time of the Info.plist file acquired from the executionPath property of the main bundle.|Date|
|Windows|Resource value of "/buildinfo/Timestamp" string.|Date|
|macOS(OS X)|Get the modification date and time of the config.xml file acquired from the resource of the main bundle.|Date|
|Browser|The date and time when ```cordova prepare``` was executed.|Date|
|Electron|The date and time when ```cordova prepare``` was executed.|Date|


### BuildInfo.installDate

Get the install date and time in the Date object returns.

Attention:
- Browser and Electron: Installation date and time is unknown.

|Platform|Value|Type|
|--------|-----|----|
|Android|The firstInstallTime property of PackageInfo|Date|
|iOS|Get the creation date and time of the document directory.|Date|
|Windows|The installedDate property of Windows.ApplicatinoModel.Package.current|Date|
|macOS(OS X)|Date and time of kMDItemDateAdded recorded in File Metadata of application package.|Date|
|Browser|Not available.|null|
|Electron|Not available.|null|


### BuildInfo.windows

Windows Only.

Get the windows extra information.

|Platform|Value|Type|
|--------|-----|----|
|Android|undefined|undefined|
|iOS|undefined|undefined|
|Windows|Object|Object|
|macOS(OS X)|undefined|undefined|
|Browser|undefined|undefined|
|Electron|undefined|undefined|

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