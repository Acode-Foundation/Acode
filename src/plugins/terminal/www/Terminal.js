const Executor = require("./Executor");


const AXS_VERSION_TAG="v0.2.5"

const Terminal = {
    async initSandbox(){
        system.getFilesDir((filesDir) => {
            const tmpDir = filesDir + "/tmp";            
            system.mkdirs(tmpDir,()=>{},()=>{})
            system.getNativeLibraryPath(async (path)=>{
                system.fileExists(`${filesDir}/libtalloc.so.2`,true,async (result)=>{
                    if(result == 1){
                        await Executor.execute(`rm ${filesDir}/libtalloc.so.2`)
                    }
                    await Executor.execute(`ln -s ${path}/libtalloc.so ${filesDir}/libtalloc.so.2`)
                },(err)=>{console.error(err)})
            })
        },(err)=>{console.error(err)})
    },

    async startAxs(){
        const nativeLibs = await new Promise((resolve, reject) => {
            system.getNativeLibraryPath(resolve, reject);
        });

        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        Executor.start('sh', (type, data) => {
            if (type === 'stdout') console.log(data);
            if (type === 'stderr') console.error(data);
            if (type === 'exit') console.log('EXIT:', data);
          }).then(pid => {
            Executor.execute(`echo \"${pid}\" > ${filesDir}/pid`)
            Executor.write(pid, `export LD_LIBRARY_PATH=${filesDir}`);
            Executor.write(pid, `export PROOT_TMP_DIR=${filesDir}/tmp`);
            Executor.write(pid, `export PROOT_LOADER=${nativeLibs}/libproot.so`);
            Executor.write(pid, `export PROOT_LOADER32=${nativeLibs}/libproot32.so`);
            Executor.write(pid, `chmod +x ${filesDir}/axs`);

            Executor.write(pid, `${nativeLibs}/libproot-xed.so -b ${filesDir}:${filesDir} -b /data:/data -b /system:/system -b /vendor:/vendor -S ${filesDir}/alpine`);
            Executor.write(pid, `command -v bash >/dev/null 2>&1 || apk update && apk add bash`);

            Executor.write(pid, `${filesDir}/axs`);
           
          }).catch(console.error);
          
    },
    
    async stopAxs(){
      const pid = await Executor.execute(`cat ${filesDir}/pid`)
      Executor.stop(pid)
    },
    
    async isAxsRunning(){
      const pid = await Executor.execute(`cat ${filesDir}/pid`)
      return await Executor.isRunning(pid)
    },
    
    async install() {
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
            axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-aarch64-unknown-linux-musl`
            alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/aarch64/alpine-minirootfs-3.21.0-aarch64.tar.gz";
          } else if (arch === "armeabi-v7a") {
            axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-android-armv7`
            alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/armhf/alpine-minirootfs-3.21.0-armhf.tar.gz";
          } else if (arch === "x86_64") {
            axsUrl = `https://github.com/bajrangCoder/acodex_server/releases/download/${AXS_VERSION_TAG}/axs-android-x86_64`
            alpineUrl = "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-minirootfs-3.21.0-x86_64.tar.gz";
          } else {
            throw new Error(`Unsupported architecture: ${arch}`);
          }
      
          console.log("Downloading files...");
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
          console.log("✅ Download complete");
      
          await new Promise((resolve, reject) => {
            system.mkdirs(`${filesDir}/.downloaded`, resolve, reject);
          });
      
          const alpineDir = `${filesDir}/alpine`;
      
          await new Promise((resolve, reject) => {
            system.mkdirs(alpineDir, resolve, reject);
          });
      
          console.log("Extracting...")
          await Executor.execute(`tar -xvf ${filesDir}/alpine.tar.gz -C ${alpineDir}`);
          console.log("✅ Extraction complete");
      
          await new Promise((resolve, reject) => {
            system.mkdirs(`${filesDir}/.extracted`, resolve, reject);
          });
      
        } catch (e) {
          console.error("installation failed:", e);
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

module.exports = Terminal