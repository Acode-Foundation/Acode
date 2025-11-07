import browser from "plugins/browser";
import appSettings from "./settings";
import {Log} from "./Log";
import {FileServer} from "./fileServer";
import {FileObjectBuilder} from "../fileSystem/FileObjectBuilder";


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


    const fileObjectBuilder = new FileObjectBuilder()
    const documentFile = await fileObjectBuilder.build(activeFile.uri);

    const projectFolder = await fileObjectBuilder.build(addedFolder[0].url)
    log.d(projectFolder.uri)


    let root = documentFile
    if (await projectFolder.isMyChild(documentFile)){
        root = projectFolder
    }else{
        root = await documentFile.getParentFile()
        if (root == null || await root.exists()){
            root = documentFile
        }
    }


    const port = 8080
    let fileServer;

    const path = await buildPathFromFile(documentFile,root)
    log.d(`PATH ${path}`)
    let url = `http://localhost:${port}/${path}`;

    log.d(url)

    fileServer = new FileServer(port,root)

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

//returns a string without a '/' prefix
async function buildPathFromFile(file, rootDirectory) {
    const parts = [];
    let current = file;

    while (current !== null && await current.toUri() !== await rootDirectory.toUri()) {
        parts.unshift(await current.getName()); // Add to the beginning
        current = await current.getParentFile();
    }

    return parts.length === 0 ? await file.getName() : "/" + parts.join("/");
}

export default run;