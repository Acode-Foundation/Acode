const Executor = require("./Executor");

/**
 * AXS server version tag to be used in downloads.
 * @constant {string}
 */
const AXS_VERSION_TAG = "v0.2.5";

const Terminal = {
    /**
     * Starts the AXS environment by writing init scripts and executing the sandbox.
     * @param {boolean} [installing=false] - Whether AXS is being started during installation.
     * @param {Function} [logger=console.log] - Function to log standard output.
     * @param {Function} [err_logger=console.error] - Function to log errors.
     * @returns {Promise<void>}
     */
    async startAxs(installing = false, logger = console.log, err_logger = console.error) {
        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        readAsset("init-alpine.sh", async (content) => {
            system.writeText(`${filesDir}/init-alpine.sh`, content, logger, err_logger);
        });

        readAsset("init-sandbox.sh", (content) => {
            system.writeText(`${filesDir}/init-sandbox.sh`, content, logger, err_logger);

            Executor.start("sh", (type, data) => {
                logger(`${type} ${data}`);
            }).then(async (uuid) => {
                await Executor.write(uuid, `source ${filesDir}/init-sandbox.sh ${installing ? "--installing" : ""}; exit`);
            });
        });
    },

    /**
     * Stops the AXS process by forcefully killing it.
     * @returns {Promise<void>}
     */
    async stopAxs() {
        await Executor.execute(`kill -KILL $(cat $PREFIX/pid)`);
    },

    /**
     * Checks if the AXS process is currently running.
     * @returns {Promise<boolean>} - `true` if AXS is running, `false` otherwise.
     */
    async isAxsRunning() {
        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        const pidExists = await new Promise((resolve, reject) => {
            system.fileExists(`${filesDir}/pid`, false, (result) => {
                resolve(result == 1);
            }, reject);
        });

        if (!pidExists) return false;

        const result = await Executor.execute(`kill -0 $(cat $PREFIX/pid) 2>/dev/null && echo "true" || echo "false"`);
        return String(result).toLowerCase() === "true";
    },

    /**
     * Installs Alpine by downloading binaries and extracting the root filesystem.
     * Also sets up additional dependencies for F-Droid variant.
     * @param {Function} [logger=console.log] - Function to log standard output.
     * @param {Function} [err_logger=console.error] - Function to log errors.
     * @returns {Promise<void>}
     */
    async install(logger = console.log, err_logger = console.error) {
        if (await this.isInstalled()) return;
        if (!(await this.isSupported())) return;

        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        const arch = await new Promise((resolve, reject) => {
            system.getArch(resolve, reject);
        });

        try {
            let alpineUrl;
            let axsUrl;
            let prootUrl = "";
            let libTalloc = "";

            if (arch === "arm64-v8a") {
                axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-musl-android-arm64`;
                alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/aarch64/alpine-minirootfs-3.21.0-aarch64.tar.gz";
            } else if (arch === "armeabi-v7a") {
                axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-musl-android-armv7`;
                alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/armhf/alpine-minirootfs-3.21.0-armhf.tar.gz";
            } else if (arch === "x86_64") {
                axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-musl-android-x86_64`;
                alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-minirootfs-3.21.0-x86_64.tar.gz";
            } else {
                throw new Error(`Unsupported architecture: ${arch}`);
            }

            logger("Downloading files...");

            await new Promise((resolve, reject) => {
                cordova.plugin.http.downloadFile(
                    alpineUrl, {}, {},
                    cordova.file.dataDirectory + "alpine.tar.gz",
                    resolve, reject
                );
            });

            await new Promise((resolve, reject) => {
                cordova.plugin.http.downloadFile(
                    axsUrl, {}, {},
                    cordova.file.dataDirectory + "axs",
                    resolve, reject
                );
            });

            const isFdroid = await Executor.execute("echo $FDROID");
            if (isFdroid === "true") {
                logger("Fdroid flavor detected, downloading extra files...");
                await new Promise((resolve, reject) => {
                    cordova.plugin.http.downloadFile(
                        prootUrl, {}, {},
                        cordova.file.dataDirectory + "libproot-xed.so",
                        resolve, reject
                    );
                });

                await new Promise((resolve, reject) => {
                    cordova.plugin.http.downloadFile(
                        libTalloc, {}, {},
                        cordova.file.dataDirectory + "libtalloc.so.2",
                        resolve, reject
                    );
                });
            }

            logger("✅ Download complete");

            await new Promise((resolve, reject) => {
                system.mkdirs(`${filesDir}/.downloaded`, resolve, reject);
            });

            const alpineDir = `${filesDir}/alpine`;

            await new Promise((resolve, reject) => {
                system.mkdirs(alpineDir, resolve, reject);
            });

            logger("Extracting...");
            await Executor.execute(`tar -xf ${filesDir}/alpine.tar.gz -C ${alpineDir}`);

            system.writeText(`${alpineDir}/etc/resolv.conf`, `nameserver 8.8.4.4 \nnameserver 8.8.8.8`);

            logger("✅ Extraction complete");

            await new Promise((resolve, reject) => {
                system.mkdirs(`${filesDir}/.extracted`, resolve, reject);
            });

            this.startAxs(true, logger, err_logger);

        } catch (e) {
            err_logger("Installation failed:", e);
        }
    },

    /**
     * Checks if alpine is already installed.
     * @returns {Promise<boolean>} - Returns true if all required files and directories exist.
     */
    isInstalled() {
        return new Promise(async (resolve, reject) => {
            const filesDir = await new Promise((resolve, reject) => {
                system.getFilesDir(resolve, reject);
            });

            const alpineExists = await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/alpine.tar.gz`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            const downloaded = alpineExists && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.downloaded`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            const extracted = alpineExists && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.extracted`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            resolve(alpineExists && downloaded && extracted);
        });
    },

    /**
     * Checks if the current device architecture is supported.
     * @returns {Promise<boolean>} - `true` if architecture is supported, otherwise `false`.
     */
    isSupported() {
        return new Promise((resolve, reject) => {
            system.getArch((arch) => {
                resolve(["arm64-v8a", "armeabi-v7a", "x86_64"].includes(arch));
            }, reject);
        });
    }
};


function readAsset(assetPath, callback) {
    const assetUrl = "file:///android_asset/" + assetPath;

    window.resolveLocalFileSystemURL(assetUrl, fileEntry => {
        fileEntry.file(file => {
            const reader = new FileReader();
            reader.onloadend = () => callback(reader.result);
            reader.readAsText(file);
        }, console.error);
    }, console.error);
}

module.exports = Terminal;
