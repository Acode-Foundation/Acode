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

function uninstallWindows(context, windowsPath) {
    const targetPath = path.join(windowsPath, 'CordovaApp.projitems');
    let projitems = fs.readFileSync(targetPath).toString();
    let changed = false;

    // Replace <PRIResource Include="strings\buildinfo.resjson"> to <Content Include="strings\buildinfo.resjson">
    if (projitems.match(/<ItemGroup>[\s]*?<PRIResource +.*?Include="strings\/buildinfo.resjson".+/m)) {

        const search = /<ItemGroup>[\s]*?<PRIResource +.*?Include="strings\/buildinfo.resjson"[\s\S]*?<\/ItemGroup>/m;

        const replace
            = "<ItemGroup>\r\n"
            + "        <Content Include=\"strings\/buildinfo.resjson\" />\r\n"
            + "    </ItemGroup>";

        projitems = projitems.replace(search, replace);
        changed = true;
    }

    // Remove <Target Name="BuildInfo_Timestamp" BeforeTargets=BeforeBuild">
    if (projitems.match(/<Target +.*Name="BuildInfo_Timestamp".*/)) {

        const search = /[\r\n ]*<Target +.*Name="BuildInfo_Timestamp"[\s\S]*?<\/Target>/gm;

        projitems = projitems.replace(search, '');
        changed = true;
    }
    
    // if variable "changed" is true, write to file.
    if (changed) {
        fs.writeFileSync(targetPath, projitems);
    }
}

module.exports = function (context) {
    const opts = context.opts || {};
    const projectRoot = opts.projectRoot;

    if ('string' != typeof projectRoot) {
        return;
    }

    // Exists platform/windows
    const windowsPath = path.join(projectRoot, 'platforms', 'windows');
    if (context.opts.plugin.platform == 'windows' && fs.existsSync(windowsPath)) {
        uninstallWindows(context, windowsPath);
    }
};