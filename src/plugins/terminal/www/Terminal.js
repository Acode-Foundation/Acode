const Executor = require("./Executor");


const AXS_VERSION_TAG="v0.2.5"

const Terminal = {
    async startAxs(installing = false,logger = console.log,err_logger = console.error){ 
        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        readAsset("init-alpine.sh",async (content)=>{
          system.writeText(`${filesDir}/init-alpine.sh`,content,logger,err_logger)
        })

        readAsset("init-sandbox.sh",(content)=>{

          system.writeText(`${filesDir}/init-sandbox.sh`,content,logger,err_logger)

          Executor.start("sh", (type, data) => {
            logger(data);
          }).then(async (pid) => {
            system.writeText(`${filesDir}/pid`,pid,logger,err_logger)
            await Executor.write(pid, `source ${filesDir}/init-sandbox.sh ${installing ? "--installing" : ""}; exit`);
          });
        })
  
    },
    
    async stopAxs(){
      const pidExists = await new Promise((resolve, reject) => {
        system.fileExists(`${filesDir}/pid`, false, (result) => {
          resolve(result == 1);
        }, reject);
    });

    if(pidExists){
      const pid = await Executor.execute(`cat ${filesDir}/pid`)
      Executor.stop(pid)
    }

    },
    
    async isAxsRunning(){
      const pidExists = await new Promise((resolve, reject) => {
        system.fileExists(`${filesDir}/pid`, false, (result) => {
          resolve(result == 1);
        }, reject);
    });

    if(!pidExists){
      return false
    }

      const pid = await Executor.execute(`cat ${filesDir}/pid`)
      return await Executor.isRunning(pid)
    },
    
    async install(logger = console.log,err_logger = console.error) {
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
          if (arch === "arm64-v8a") {
            axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-musl-android-arm64`
            alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/aarch64/alpine-minirootfs-3.21.0-aarch64.tar.gz";
          } else if (arch === "armeabi-v7a") {
            axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-musl-android-armv7`
            alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/armhf/alpine-minirootfs-3.21.0-armhf.tar.gz";
          } else if (arch === "x86_64") {
            axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-musl-android-x86_64`
            alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-minirootfs-3.21.0-x86_64.tar.gz";
          } else {
            throw new Error(`Unsupported architecture: ${arch}`);
          }
      
          logger("Downloading files...");
          await new Promise((resolve, reject) => {
            cordova.plugin.http.downloadFile(
              alpineUrl,
              {},
              {},
              cordova.file.dataDirectory + "alpine.tar.gz",
              resolve,
              reject
            );
          });

          await new Promise((resolve, reject) => {
            cordova.plugin.http.downloadFile(
              axsUrl,
              {},
              {},
              cordova.file.dataDirectory + "axs",
              resolve,
              reject
            );
          });
          logger("✅ Download complete");
      
          await new Promise((resolve, reject) => {
            system.mkdirs(`${filesDir}/.downloaded`, resolve, reject);
          });

          const alpineDir = `${filesDir}/alpine`;

          await new Promise((resolve, reject) => {
            system.mkdirs(alpineDir, resolve, reject);
          });

          logger("Extracting...")
          await Executor.execute(`tar -xf ${filesDir}/alpine.tar.gz -C ${alpineDir}`);

          system.writeText(`${alpineDir}/etc/resolv.conf`,`nameserver 8.8.4.4 \nnameserver 8.8.8.8`)


          logger("✅ Extraction complete");

          await new Promise((resolve, reject) => {
            system.mkdirs(`${filesDir}/.extracted`, resolve, reject);
          });

          //update system and install required packages
          this.startAxs(true,logger,err_logger)
    
        } catch (e) {
          err_logger("Installation failed:", e);
        }
    },      
    
    isInstalled() {
        return new Promise(async (resolve, reject) => {

            const filesDir = await new Promise((resolve, reject) => {
                system.getFilesDir(resolve, reject);
            });

            
            const alpineExits = await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/alpine.tar.gz`, false, (result) => {
                  resolve(result == 1);
                }, reject);
            });
    
            const fileExists = alpineExits && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.downloaded`, false, (result) => {
                  resolve(result == 1);
                }, reject);
            });
    
    
            const extracted = alpineExits && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.extracted`, false, (result) => {
                  resolve(result == 1);
                }, reject);
            });

    
            resolve(alpineExits && fileExists && extracted)
        });
    },
    isSupported() {
        return new Promise((resolve, reject) => {
            system.getArch((arch) => {
                if (arch === "arm64-v8a" || arch === "armeabi-v7a" || arch === "x86_64") {
                    resolve(true);
                } else {
                    resolve(false); // Unsupported CPU
                }
            }, (err) => reject(err));
        });
    }
    
}


function readAsset(assetPath, callback) {
  const assetUrl = "file:///android_asset/" + assetPath;

  window.resolveLocalFileSystemURL(assetUrl, fileEntry => {
    fileEntry.file(file => {
      const reader = new FileReader();

      reader.onloadend = () => callback(reader.result);
      reader.readAsText(file);
    },console.error);
  }, console.error);
}


module.exports = Terminal