import ajax from '../ajax';
import path from '../path';
/**
 * 
 * @param {string} path 
 * @returns {Promise}
 */
function listDir(path) {

    return new Promise((resolve, reject) => {
        window.resolveLocalFileSystemURL(path, success, reject);

        function success(fs) {
            const reader = fs.createReader();
            reader.readEntries(resolve, reject);
        }
    });

}

/**
 * 
 * @param {string} filename 
 * @param {any} data
 * @param {boolean} create If this property is true, and the requested file or 
 * directory doesn't exist, the user agent should create it. 
 * The default is false. The parent directory must already exist.
 * @param {boolean} exclusive If true, and the create option is also true, 
 * the file must not exist prior to issuing the call. 
 * Instead, it must be possible for it to be created newly at call time. The default is false.
 * @returns {Promise} 
 */
function writeFile(filename, data, create = false, exclusive = true) {
    const name = filename.split('/').pop();
    const _path = path.parent(filename, name);
    return new Promise((resolve, reject) => {
        if (!create) {
            window.resolveLocalFileSystemURL(filename, fileEntry => {
                if (!fileEntry.isFile) reject('Expected file but got directory.');
                fileEntry.createWriter(file => {
                    file.onwriteend = resolve;
                    file.onerror = (err) => reject(err.target.error);
                    file.write(data);
                });
            }, reject);
        } else {
            window.resolveLocalFileSystemURL(_path, fs => {
                fs.getFile(name, {
                    create,
                    exclusive: create ? exclusive : false
                }, fileEntry => {
                    fileEntry.createWriter(file => {
                        file.onwriteend = resolve;
                        file.onerror = (err) => reject(err.target.error);
                        file.write(data);
                    });
                }, reject);
            }, reject);
        }
    });
}

/**
 * 
 * @param {string} filename
 * @returns {Promise} 
 */
function deleteFile(filename) {
    return new Promise((resolve, reject) => {
        window.resolveLocalFileSystemURL(filename, entry => {
            if (entry.isFile) {
                entry.remove(resolve, reject);
            } else {
                entry.removeRecursively(resolve, reject);
            }
        }, reject);
    });
}

/**
 * 
 * @param {string} filename
 * @returns {Promise} 
 */
function readFile(filename) {
    return new Promise((resolve, reject) => {

        if (!filename) return reject("Invalid valud of fileURL: " + filename);

        ajax({
            url: filename,
            responseType: "arraybuffer"
        }).then(res => {

            if (res)
                resolve({
                    data: res
                });
            else
                return Promise.reject();

        }).catch(() => {
            window.resolveLocalFileSystemURL(filename, fileEntry => {
                fileEntry.file(file => {
                    const fileReader = new FileReader();
                    fileReader.onloadend = function () {
                        resolve({
                            file,
                            data: this.result
                        });
                    };

                    fileReader.onerror = reject;

                    fileReader.readAsArrayBuffer(file);
                }, reject);
            }, reject);
        });
    });
}

/**
 * 
 * @param {string} uri 
 * @param {string} newname
 * @returns {Promise} 
 */
function renameFile(uri, newname) {
    return new Promise((resolve, reject) => {
        window.resolveLocalFileSystemURL(uri, fs => {
            fs.getParent(parent => {
                fs.moveTo(parent, newname, () => resolve(parent), reject);
            }, reject);
        }, reject);
    });
}

/**
 * 
 * @param {string} path 
 * @param {string} dirname
 * @returns {Promise} 
 */
function createDir(path, dirname) {
    return new Promise((resolve, reject) => {
        window.resolveLocalFileSystemURL(path, fs => {
            fs.getDirectory(dirname, {
                create: true
            }, resolve, reject);
        }, reject);
    });
}


export default {
    listDir,
    writeFile,
    deleteFile,
    readFile,
    renameFile,
    createDir
};