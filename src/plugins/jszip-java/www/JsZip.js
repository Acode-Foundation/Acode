/*
 * JsZip-Java - A complete drop-in replacement for JSZip with a Java backend for Cordova.
 */

var exec = require('cordova/exec');

function genUUID() {
    return 'zip_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function arrayBufferToBase64(bufferOrView) {
    var bytes;
    if (bufferOrView instanceof ArrayBuffer) {
        bytes = new Uint8Array(bufferOrView);
    } else if (ArrayBuffer.isView(bufferOrView)) {
        bytes = new Uint8Array(bufferOrView.buffer, bufferOrView.byteOffset, bufferOrView.byteLength);
    } else {
        throw new Error("Invalid buffer type");
    }
    var binary = '';
    var len = bytes.byteLength;
    var chunk = 8192;
    for (var i = 0; i < len; i += chunk) {
        var slice = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, slice);
    }
    return window.btoa(binary);
}

function JSZip() {
    if (!(this instanceof JSZip)) {
        return new JSZip();
    }
    this.id = genUUID();
    this.root = this;
    this.prefix = "";
    this.files = {};
    this._pending = [];

    // Notify native of instance creation
    exec(null, null, "JsZip", "create", [this.id]);
}

JSZip.support = {
    arraybuffer: true,
    uint8array: true,
    blob: true,
    nodebuffer: false,
    base64: true
};

JSZip.external = {
    Promise: window.Promise
};

JSZip.version = "3.10.1";

JSZip.defaults = {
    compression: "STORE",
    compressionOptions: {
        level: null
    }
};

JSZip.prototype.folder = function(name) {
    if (name instanceof RegExp) {
        var results = [];
        var regex = name;
        for (var filename in this.files) {
            var file = this.files[filename];
            if (file.dir && filename.indexOf(this.prefix) === 0) {
                var relative = filename.slice(this.prefix.length);
                if (regex.test(relative)) {
                    results.push(file);
                }
            }
        }
        return results;
    }

    if (!name.endsWith('/')) {
        name += '/';
    }
    var fullPath = this.prefix + name;

    if (!this.root.files[fullPath]) {
        var folderObj = new JSZipObject(fullPath, true, this.root);
        this.root.files[fullPath] = folderObj;
        
        exec(null, null, "JsZip", "addFile", [this.root.id, fullPath, null, { dir: true }]);
    }

    var child = Object.create(JSZip.prototype);
    child.id = this.root.id;
    child.root = this.root;
    child.prefix = fullPath;
    child.files = this.root.files;
    child._pending = this.root._pending;
    return child;
};

JSZip.prototype.file = function(name, data, options) {
    if (name instanceof RegExp) {
        var results = [];
        var regex = name;
        for (var filename in this.files) {
            var file = this.files[filename];
            if (!file.dir && filename.indexOf(this.prefix) === 0) {
                var relative = filename.slice(this.prefix.length);
                if (regex.test(relative)) {
                    results.push(file);
                }
            }
        }
        return results;
    }

    if (data === undefined || data === null) {
        var fullPath = this.prefix + name;
        if (options && options.dir) {
            return this.folder(name);
        }
        return this.root.files[fullPath] || null;
    }

    var fullPath = this.prefix + name;
    options = options || {};

    if (typeof data.then === 'function') {
        var self = this;
        var promise = data.then(function(resolvedData) {
            return self._addFileToNative(fullPath, resolvedData, options);
        });
        this.root._pending.push(promise);

        var fileObj = new JSZipObject(fullPath, false, this.root, options);
        this.root.files[fullPath] = fileObj;
    } else {
        this._addFileToNative(fullPath, data, options);
        var fileObj = new JSZipObject(fullPath, false, this.root, options);
        this.root.files[fullPath] = fileObj;
    }

    return this;
};

JSZip.prototype._ensureParentFolders = function(fullPath) {
    var parts = fullPath.split('/');
    var current = "";
    for (var i = 0; i < parts.length - 1; i++) {
        current += parts[i] + "/";
        if (!this.root.files[current]) {
            var folderObj = new JSZipObject(current, true, this.root);
            this.root.files[current] = folderObj;
            exec(null, null, "JsZip", "addFile", [this.root.id, current, null, { dir: true }]);
        }
    }
};

JSZip.prototype._addFileToNative = function(fullPath, data, options) {
    var self = this;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        var promise = new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                resolve(e.target.result);
            };
            reader.onerror = function(err) {
                reject(err);
            };
            reader.readAsArrayBuffer(data);
        }).then(function(buffer) {
            return self._addFileToNative(fullPath, buffer, options);
        });
        this.root._pending.push(promise);
        return;
    }

    var createFolders = options.createFolders !== false;
    if (createFolders) {
        this._ensureParentFolders(fullPath);
    }

    var dataType = "string";
    var payload = data;
    if (data instanceof ArrayBuffer) {
        dataType = "base64";
        payload = arrayBufferToBase64(data);
    } else if (ArrayBuffer.isView(data)) {
        dataType = "base64";
        payload = arrayBufferToBase64(data);
    } else if (options.base64) {
        dataType = "base64";
    }

    if (data && typeof data.async === 'function') {
        var promise = data.async("arraybuffer").then(function(buffer) {
            return self._addFileToNative(fullPath, buffer, options);
        });
        this.root._pending.push(promise);
        return;
    }

    exec(null, null, "JsZip", "addFile", [
        this.root.id,
        fullPath,
        payload,
        {
            dataType: dataType,
            dir: options.dir || false,
            date: options.date ? (options.date instanceof Date ? options.date.getTime() : options.date) : null,
            comment: options.comment || "",
            unixPermissions: options.unixPermissions || null,
            dosPermissions: options.dosPermissions || null,
            binary: options.binary || false
        }
    ]);
};

JSZip.prototype.remove = function(name) {
    var fullPath = this.prefix + name;
    var normalizedPath = fullPath.endsWith('/') ? fullPath : fullPath + '/';
    
    for (var filename in this.root.files) {
        if (filename === fullPath || filename === normalizedPath || filename.indexOf(normalizedPath) === 0) {
            delete this.root.files[filename];
        }
    }
    
    exec(null, null, "JsZip", "removeFile", [this.root.id, fullPath]);
    return this;
};

JSZip.prototype.forEach = function(callback) {
    for (var filename in this.files) {
        if (filename.indexOf(this.prefix) === 0 && filename !== this.prefix) {
            var relativePath = filename.slice(this.prefix.length);
            callback(relativePath, this.files[filename]);
        }
    }
};

JSZip.prototype.filter = function(callback) {
    var results = [];
    this.forEach(function(relativePath, file) {
        if (callback(relativePath, file)) {
            results.push(file);
        }
    });
    return results;
};

JSZip.prototype._convertOutput = function(base64Data, type, mimeType) {
    type = (type || "").toLowerCase();
    if (type === "base64") {
        return base64Data;
    }
    
    var binaryString = window.atob(base64Data);
    var len = binaryString.length;

    if (type === "string" || type === "binarystring") {
        return binaryString;
    }

    if (type === "text") {
        return decodeURIComponent(escape(binaryString));
    }

    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    if (type === "array") {
        var arr = new Array(len);
        for (var i = 0; i < len; i++) {
            arr[i] = bytes[i];
        }
        return arr;
    }

    if (type === "uint8array") {
        return bytes;
    }

    if (type === "arraybuffer") {
        return bytes.buffer;
    }

    if (type === "blob") {
        return new Blob([bytes], { type: mimeType });
    }

    throw new Error("Type '" + type + "' is not supported or not implemented.");
};

JSZip.prototype.generateAsync = function(options, onUpdate) {
    options = options || {};
    var type = options.type || "base64";
    var compression = options.compression || "STORE";
    var compressionOptions = options.compressionOptions || {};
    var comment = options.comment || null;
    var mimeType = options.mimeType || "application/zip";
    var self = this;

    return Promise.all(this.root._pending).then(function() {
        self.root._pending = [];

        return new Promise(function(resolve, reject) {
            exec(
                function(result) {
                    if (result && result.progress) {
                        if (typeof onUpdate === 'function') {
                            onUpdate({
                                percent: result.percent,
                                currentFile: result.currentFile
                            });
                        }
                        return;
                    }
                    var base64Data = result.data;
                    try {
                        resolve(self._convertOutput(base64Data, type, mimeType));
                    } catch (e) {
                        reject(e);
                    }
                },
                function(err) {
                    reject(err);
                },
                "JsZip",
                "generate",
                [
                    self.root.id,
                    self.prefix,
                    {
                        compression: compression,
                        compressionLevel: compressionOptions.level || 6,
                        comment: comment
                    }
                ]
            );
        });
    });
};

JSZip.prototype.loadAsync = function(data, options) {
    options = options || {};
    var self = this;
    
    return Promise.resolve()
        .then(function() {
            if (typeof Blob !== 'undefined' && data instanceof Blob) {
                return new Promise(function(resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function(e) {
                        resolve({
                            payload: arrayBufferToBase64(e.target.result),
                            dataType: "base64"
                        });
                    };
                    reader.onerror = function(err) {
                        reject(err);
                    };
                    reader.readAsArrayBuffer(data);
                });
            } else if (data instanceof ArrayBuffer) {
                return {
                    payload: arrayBufferToBase64(data),
                    dataType: "base64"
                };
            } else if (ArrayBuffer.isView(data)) {
                return {
                    payload: arrayBufferToBase64(data),
                    dataType: "base64"
                };
            } else if (typeof data === 'string') {
                if (options.base64) {
                    return {
                        payload: data,
                        dataType: "base64"
                    };
                } else {
                    var base64 = window.btoa(data);
                    return {
                        payload: base64,
                        dataType: "base64"
                    };
                }
            } else {
                throw new Error("Unsupported data type for loadAsync");
            }
        })
        .then(function(normalized) {
            return new Promise(function(resolve, reject) {
                exec(
                    function(result) {
                        var filesList = (result && result.files) ? result.files : result;
                        filesList.forEach(function(meta) {
                            var fileObj = new JSZipObject(
                                meta.name,
                                meta.dir,
                                self.root,
                                {
                                    date: meta.date ? new Date(meta.date) : null,
                                    comment: meta.comment || "",
                                    unixPermissions: meta.unixPermissions,
                                    dosPermissions: meta.dosPermissions
                                }
                            );
                            self.root.files[meta.name] = fileObj;
                        });
                        resolve(self);
                    },
                    function(err) {
                        reject(err);
                    },
                    "JsZip",
                    "load",
                    [
                        self.root.id,
                        normalized.payload,
                        {
                            checkCRC32: options.checkCRC32 || false,
                            createFolders: options.createFolders || false
                        }
                    ]
                );
            });
        });
};

JSZip.loadAsync = function(data, options) {
    return new JSZip().loadAsync(data, options);
};

JSZip.prototype.extractToDir = function(targetDir, onUpdate) {
    var self = this;
    return Promise.all(this.root._pending).then(function() {
        self.root._pending = [];

        return new Promise(function(resolve, reject) {
            exec(
                function(result) {
                    if (result && result.progress) {
                        if (typeof onUpdate === 'function') {
                            onUpdate({
                                percent: result.percent,
                                currentFile: result.currentFile
                            });
                        }
                        return;
                    }
                    resolve();
                },
                function(err) {
                    reject(err);
                },
                "JsZip",
                "extractToDir",
                [
                    self.root.id,
                    self.prefix,
                    targetDir
                ]
            );
        });
    });
};

JSZip.extractToDir = function(zipFilePath, targetDir, onUpdate) {
    return new Promise(function(resolve, reject) {
        exec(
            function(result) {
                if (result && result.progress) {
                    if (typeof onUpdate === 'function') {
                        onUpdate({
                            percent: result.percent,
                            currentFile: result.currentFile
                        });
                    }
                    return;
                }
                resolve();
            },
            function(err) {
                reject(err);
            },
            "JsZip",
            "extractZipFileToDir",
            [
                zipFilePath,
                targetDir
            ]
        );
    });
};

JSZip.prototype.destroy = function() {
    exec(null, null, "JsZip", "destroy", [this.root.id]);
};

var registry = typeof FinalizationRegistry !== 'undefined' ? new FinalizationRegistry(function(id) {
    exec(null, null, "JsZip", "destroy", [id]);
}) : null;

function JSZipObject(name, dir, root, options) {
    this.name = name;
    this.dir = dir || false;
    this.root = root;
    
    options = options || {};
    this.date = options.date || new Date();
    this.comment = options.comment || "";
    this.unixPermissions = options.unixPermissions || null;
    this.dosPermissions = options.dosPermissions || null;
    this.options = options;
}

JSZipObject.prototype.async = function(type, onUpdate) {
    var self = this;
    return new Promise(function(resolve, reject) {
        exec(
            function(result) {
                if (result && result.progress) {
                    if (typeof onUpdate === 'function') {
                        onUpdate({
                            percent: result.percent,
                            currentFile: self.name
                        });
                    }
                    return;
                }
                var base64Data = result.data;
                try {
                    resolve(self.root._convertOutput(base64Data, type, "application/octet-stream"));
                } catch (e) {
                    reject(e);
                }
            },
            function(err) {
                reject(err);
            },
            "JsZip",
            "getFileContent",
            [self.root.id, self.name, type]
        );
    });
};

JSZipObject.prototype.nodeStream = function() {
    throw new Error("nodeStream is not supported by this platform");
};

if (typeof window !== 'undefined') {
    window.JSZip = JSZip;
}

module.exports = JSZip;
