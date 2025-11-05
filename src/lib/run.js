import fsOperation from "fileSystem";
import tutorial from "components/tutorial";
import alert from "dialogs/alert";
import box from "dialogs/box";
import markdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import markdownItFootnote from "markdown-it-footnote";
import MarkdownItGitHubAlerts from "markdown-it-github-alerts";
import markdownItTaskLists from "markdown-it-task-lists";
import mimeType from "mime-types";
import mustache from "mustache";
import browser from "plugins/browser";
import helpers from "utils/helpers";
import Url from "utils/Url";
import $_console from "views/console.hbs";
import $_markdown from "views/markdown.hbs";
import constants from "./constants";
import EditorFile from "./editorFile";
import openFolder, {addedFolder} from "./openFolder";
import appSettings from "./settings";
import {Log} from "./Log";
import {SAFDocumentFile} from "../fileSystem/SAFDocumentFile";
import {FileServer} from "./fileServer";


/**
 * Starts the server and run the active file in browser
 * @param {Boolean} isConsole
 * @param {"inapp"|"browser"} target
 * @param {Boolean} runFile
 */

async function run(
    isConsole = false,
    target = appSettings.value.previewMode,
    runFile = false,
) {
    if (!isConsole && !runFile) {
        const {serverPort, previewPort, previewMode, disableCache, host} =
            appSettings.value;
        if (serverPort !== previewPort) {
            const src = `http://${host}:${previewPort}`;
            if (previewMode === "browser") {
                system.openInBrowser(src);
                return;
            }

            browser.open(src);
            return;
        }
    }

    const activeFile = editorManager.activeFile;
    if(!await activeFile?.canRun()){
        //can not run
        return;
    }

    const log = new Log("Code Runner")
    log.d(activeFile.uri)

    //todo use NativeFileObject for file:// uri
    const documentFile = new SAFDocumentFile(activeFile.uri)

    log.d(await documentFile.getName())
    log.d(await documentFile.readText())

    const fileParent = await documentFile.getParentFile()
    log.d(await fileParent.uri)

    const port = 8080
    let fileServer;

    let url = `http://localhost:${port}/${await documentFile.getName()}`;

    if (!await fileParent.exists()){
        log.d("No file parent")
        fileServer = new FileServer(port,documentFile)
    }else{
        log.d(await fileParent.getName())
        fileServer = new FileServer(port,fileParent)
    }


    fileServer.start((msg)=>{
        //success
        log.d(msg)

        if (target === "browser") {
            system.openInBrowser(url);
        }else{
            browser.open(url,false);
        }


    },(err)=>{
        //error
        log.e(err)
    })




}


export default run;