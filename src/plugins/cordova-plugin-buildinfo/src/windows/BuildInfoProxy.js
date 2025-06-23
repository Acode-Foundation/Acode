/*
The MIT License (MIT)

Copyright (c) 2017 Mikihiro Hayashi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

BuildInfoProxy = {
    _cache: null,

    init: function (successCallback, errorCallback, args) {
        var self = BuildInfoProxy;

        if (null !== self._cache) {
            successCallback(self._cache);
            return;
        }

        var res = {};
        
        var package = Windows.ApplicationModel.Package.current; 
        var packId = package.id;
        var version = packId.version;

        var timestamp = WinJS.Resources.getString('/buildinfo/Timestamp');

        res.packageName = packId.name;
        res.basePackageName = packId.name;
        res.displayName = package.displayName;
        res.name = package.displayName;
        res.version = [version.major, version.minor, version.build].join('.');
        res.versionCode = [version.major, version.minor, version.build, version.revision].join('.');
        res.debug = package.isDevelopmentMode;
        res.buildType = (res.debug) ? "debug" : "release";
        res.flavor = "";
        res.installDate = package.installedDate;
        //res.buildDate = timestamp ? new Date(timestamp.value) : null;

        // Windows
        res.windows = {
            description: package.description,
            displayName: package.displayName,
            publisherDisplayName: package.publisherDisplayName,
            architecture: packId.architecture,
            familyName: packId.familyName,
            fullName: packId.fullName,
            publisher: packId.publisher,
            publisherId: packId.publisherId,
            resourceId: packId.resourceId,
            version: packId.version,
            logo: {
                absoluteCanonicalUri: package.logo.absoluteCanonicalUri,
                absoluteUri: package.logo.absoluteUri,
                displayIri: package.logo.displayIri,
                displayUri: package.logo.displayUri,
                path: package.logo.path,
                rawUri: package.logo.rawUri
            }
        };

        var promiseDoneFunc = function done(res) {
            if (res.debug) {
                var log = console.debug ? console.debug : console.log;
                log("packageName    : \"" + res.packageName + "\"");
                log("basePackageName: \"" + res.basePackageName + "\"");
                log("displayName    : \"" + res.displayName + "\"");
                log("name           : \"" + res.name + "\"");
                log("version        : \"" + res.version + "\"");
                log("versionCode    : \"" + res.versionCode + "\"");
                log("debug          : " + (res.debug ? "true" : "false"));
                log("buildType      : \"" + res.buildType + "\"");
                log("flavor         : \"" + res.flavor + "\"");
                //log("buildDate      : \"" + res.buildDate + "\"");
                log("installDate    : \"" + res.installDate + "\"");
            }

            self._cache = res;

            successCallback(res);
        };

        package.installedLocation.getFileAsync('AppxManifest.xml')
            .then(function (file) {
                // File read and parse
                return Windows.Storage.FileIO.readTextAsync(file).then(function (text) {
                    var xdoc = new Windows.Data.Xml.Dom.XmlDocument();
                    xdoc.loadXml(text);

                    var node = xdoc.selectSingleNode("//*[local-name()='VisualElements']");
                    var displayName = res.displayName;
                    if (node && node.attributes) {
                        var nodeDisplayName = node.attributes.getNamedItem('DisplayName');

                        if (nodeDisplayName && nodeDisplayName.nodeValue) {
                            displayName = nodeDisplayName.nodeValue;
                        }
                    }

                    // ms-resource:
                    if (displayName.startsWith('ms-resource:')) {
                        var resDisplayName = WinJS.Resources.getString(displayName.substr(12));
                        if (resDisplayName) {
                            displayName = resDisplayName.value;
                        }
                    }

                    return { displayName: displayName };
                });
            })
            .then(function (result) {
                if (result.displayName) {
                    res.displayName = result.displayName;
                }

                return res;
            })
            .done(
                function (res) {
                    promiseDoneFunc(res);
                },
                function (err) {
                    console.error(err);
                    promiseDoneFunc(res);
                }
            );
    }
};

cordova.commandProxy.add("BuildInfo", BuildInfoProxy);
