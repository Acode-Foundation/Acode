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

function installWindows(windowsPath) {

    const targetPath = path.join(windowsPath, 'CordovaApp.projitems');
    let projitems = fs.readFileSync(targetPath).toString();
    let changed = false;

    // Replace <Content Include="strings\buildinfo.resjson"> to <PRIResource Include="strings\buildinfo.resjson">
    if (projitems.match(/<ItemGroup>[\s]*?<Content +.*?Include="strings\/buildinfo.resjson".+/m)) {
        const search = /<ItemGroup>[\s]*?<Content +.*?Include="strings\/buildinfo.resjson"[\s\S]*?<\/ItemGroup>/m;

        const replace
            = "<ItemGroup>\r\n"
            + "        <PRIResource Include=\"strings\/buildinfo.resjson\" />\r\n"
            + "    </ItemGroup>";

        projitems = projitems.replace(search, replace);
        changed = true;
    }

    // Add <Target Name="BuildInfo_Timestamp" BeforeTargets=BeforeBuild">
    if (!projitems.match(/<Target +.*?Name="BuildInfo_Timestamp".*?/)) {
        const search = /<\/Project>/;

        const replace
            = "    <Target Name=\"BuildInfo_Timestamp\" BeforeTargets=\"BeforeBuild\">\r\n"
            + "        <PropertyGroup>\r\n"
            + "            <BuildInfoTimestamp>$([System.DateTime]::Now.ToString(\"yyyy-MM-dd\THH:mm:sszzz\"))</BuildInfoTimestamp>\r\n"
            + "        </PropertyGroup>\r\n"
            + "        <ItemGroup>\r\n"
            + "            <BuildInfoResJson Include=\"{\" />\r\n"
            + "            <BuildInfoResJson Include=\"&quot;Timestamp&quot;: &quot;$(BuildInfoTimestamp)&quot;\" />\r\n"
            + "            <BuildInfoResJson Include=\"}\" />\r\n"
            + "        </ItemGroup>\r\n"
            + "        <WriteLinesToFile File=\"strings\\buildinfo.resjson\" Lines=\"@(BuildInfoResJson)\" Overwrite=\"true\" Encoding=\"UTF-8\" />\r\n"
            + "    </Target>\r\n"
            + "</Project>";

        projitems = projitems.replace(search, replace);
        changed = true;
    }

    // if variable "changed" is true, write to file.
    if (changed) {
        fs.writeFileSync(targetPath, projitems);
    }
}

module.exports = function (context) {
    const projectRoot = context.opts.projectRoot;

    // Exists platform/windows
    const windowsPath = path.join(projectRoot, 'platforms', 'windows');
    if (fs.existsSync(windowsPath) && context.opts.plugin.platform == 'windows') {
        installWindows(windowsPath);
    }
};