import tag from 'html-tag-js';
import mustache from 'mustache';

import Page from "../../components/page";
import dialogs from "../../components/dialogs";
import gen from "../../components/gen";
import About from "../about/about";
import editorSettings from "./editorSettings";
import constants from "../../lib/constants";
import helpers from "../../lib/utils/helpers";
import openFile from "../../lib/openFile";
import internalFs from "../../lib/fileSystem/internalFs";
import backupRestore from "./backup-restore";
import themeSetting from "../themeSetting/themeSetting";

import $_ad from '../../views/ad.hbs';

export default function settingsMain(demo) {
    const value = appSettings.value;
    const $page = Page(strings.settings);
    const $settingsList = tag('div', {
        className: 'main list',
        style: {
            textTransform: "capitalize"
        }
    });
    const $editSettings = tag('span', {
        className: 'icon edit',
        attr: {
            style: 'font-size: 1.2em !important;',
            action: 'edit-settings'
        },
        onclick: () => {
            openFile(appSettings.settingsFile, {
                text: JSON.stringify(appSettings.value, undefined, 4),
                render: true
            });
            actionStack.pop();
        }
    });


    actionStack.push({
        id: 'settings-main',
        action: $page.hide
    });
    $page.onhide = function () {
        actionStack.remove('settings-main');
    };
    $page.querySelector('header').append($editSettings);


    const settingsOptions = [{
        key: 'language',
        text: strings['change language'],
        subText: strings.lang,
        icon: 'translate'
    }];

    if (!demo) {
        settingsOptions.push({
            key: 'editor',
            text: strings['editor settings'],
            icon: 'text_format'
        }, {
            key: 'previewMode',
            text: strings['preview mode'],
            icon: 'play_arrow',
            subText: value.previewMode === 'none' ? strings['not set'] : value.previewMode
        }, {
            key: 'theme',
            text: strings.theme,
            icon: 'color_lenspalette'
        }, {
            key: 'about',
            text: strings.about,
            icon: 'acode'
        }, {
            key: 'keybindings',
            text: strings['key bindings'],
            icon: 'keyboard_hide'
        }, {
            key: 'backup-restore',
            text: strings.backup.capitalize() + '/' + strings.restore.capitalize(),
            icon: 'cached'
        });
    }

    gen.listItems($settingsList, settingsOptions, changeSetting);

    function changeSetting() {
        const lanuguages = [];
        const langList = constants.langList;
        for (let lang in langList) {
            lanuguages.push([lang, langList[lang]]);
        }
        switch (this.key) {
            case 'language':
                dialogs.select(this.text, lanuguages, {
                        default: value.lang
                    })
                    .then(res => {
                        if (res === value.lang) return;
                        appSettings.value.lang = res;
                        appSettings.update();
                        internalFs.readFile(`${cordova.file.applicationDirectory}www/lang/${res}.json`)
                            .then(res => {
                                const text = helpers.decodeText(res.data);
                                window.strings = JSON.parse(text);
                                if (actionStack.has("settings-main")) actionStack.pop();
                            });
                    });
                break;

            case 'editor':
                editorSettings();
                break;

            case 'theme':
                themeSetting();
                break;

            case 'about':
                About();
                break;

            case 'backup-restore':
                backupRestore();
                break;

            case 'keybindings':
                dialogs.select(strings['key bindings'], [
                        ['edit', strings.edit],
                        ['reset', strings.reset]
                    ])
                    .then(res => {
                        if (res === 'edit') {
                            $page.hide();
                            openFile(KEYBINDING_FILE);
                        } else {
                            helpers.resetKeyBindings();
                        }
                    });
                break;

            case 'previewMode':
                dialogs.select(this.text, ['browser', 'in app', ['none', strings['not set']]], {
                        default: value.previewMode
                    })
                    .then(res => {
                        if (res === value.previewMode) return;
                        appSettings.value.previewMode = res;
                        appSettings.update();
                        this.changeSubText(res === 'none' ? strings['not set'] : res);
                    });
                break;

            default:
                break;
        }
    }

    $page.appendChild($settingsList);
    if (window.ad && !localStorage.hideAd) {
        const $ad = tag.parse(mustache.render($_ad, window.ad));
        $ad.onclick = function (e) {
            const action = e.target.getAttribute("action");
            if (action === "close") {
                this.remove();
                localStorage.hideAd = true;
            }
        };
        $settingsList.append($ad);
    }
    document.body.append($page);
}