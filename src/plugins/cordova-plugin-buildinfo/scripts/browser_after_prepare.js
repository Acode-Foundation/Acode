/*
The MIT License (MIT)

Copyright (c) 2019 Mikihiro Hayashi

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

'use strict';

const path = require('path'),
    fs = require('fs');

function rewriteBuildInfoProxy(context, pathPrefix) {

    const opts = context.opts || {};
    const options = opts.options || {};
    const release = options.release || false;
    const debug = options.debug || !release;

    const pluginId = (opts.plugin || {}).id || 'cordova-plugin-buildinfo';

    const pathRewriteFile = path.join(pathPrefix, 'www', 'plugins', pluginId, 'src', 'browser', 'BuildInfoProxy.js');

    if (!fs.existsSync(pathRewriteFile)) {
        console.error('File not found: '.pathRewriteFile);
        return;
    }

    const ConfigParser = context.requireCordovaModule('cordova-common').ConfigParser;
    const cfg = new ConfigParser('config.xml');

    const json = {
        debug: debug,
        packageName: cfg.packageName(),
        basePackageName: cfg.packageName(),
        name: cfg.name(),
        displayName: cfg.shortName(),
        version: cfg.version(),
        versionCode: cfg.version()
    };

    const code = 'const json = ' + JSON.stringify(json) + ';';

    const contentJs = fs.readFileSync(pathRewriteFile, 'utf8');
    const outputJs = contentJs.replace(/(\/\* <EMBED_CODE> \*\/).*?(\s*)(\/\* <\/EMBED_CODE> \*\/)/s, '$1$2' + code + '$2$3');

    fs.writeFileSync(pathRewriteFile, outputJs);
}


module.exports = function (context) {

    const opts = context.opts || {};
    const projectRoot = opts.projectRoot;
    const platforms = opts.platforms || [];

    if ('string' != typeof projectRoot) {
        return;
    }

    ['browser', 'electron'].forEach((value, index, array) => {

        if (!platforms.includes(value)) {
            return;
        }

        const pathPrefix = path.join(projectRoot, 'platforms', value);
        if (fs.existsSync(pathPrefix)) {
            rewriteBuildInfoProxy(context, pathPrefix);
        }
    });
};