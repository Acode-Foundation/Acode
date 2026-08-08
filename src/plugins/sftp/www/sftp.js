module.exports = {
  exec: function (command, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'exec', [command]);
  },
  connectUsingPassword: function (host, port, username, password, onSuccess, onFail) {
    if (typeof port != 'number') {
      throw new Error('Port must be number');
    }

    port = Number.parseInt(port);
    cordova.exec(onSuccess, onFail, 'Sftp', 'connectUsingPassword', [host, port, username, password]);
  },
  connectUsingKeyFile: function (host, port, username, keyFile, passphrase, onSuccess, onFail) {
    if (typeof port != 'number') {
      throw new Error('Port must be number');
    }

    port = Number.parseInt(port);
    cordova.exec(onSuccess, onFail, 'Sftp', 'connectUsingKeyFile', [host, port, username, keyFile, passphrase]);
  },
  connectUsingProfile: function (profileId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'connectUsingProfile', [profileId]);
  },
  saveProfile: function (profileId, host, port, username, authType, password, keyFile, passphrase, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'saveProfile', [profileId, host, port, username, authType, password, keyFile, passphrase]);
  },
  getProfileInfo: function (profileId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'getProfileInfo', [profileId]);
  },
  deleteProfile: function (profileId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'deleteProfile', [profileId]);
  },
  trustHost: function (host, algorithm, fingerprint, publicKey, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'trustHost', [host, algorithm, fingerprint, publicKey]);
  },
  getFile: function (filename, localFilename, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'getFile', [filename, localFilename]);
  },
  putFile: function (filename, localFilename, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'putFile', [filename, localFilename]);
  },
  lsDir: function (path, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'lsDir', [path]);
  },
  stat: function (path, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'stat', [path]);
  },
  mkdir: function (path, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'mkdir', [path]);
  },
  rm: function (path, force, recurse, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'rm', [path, force, recurse]);
  },
  createFile: function (path, content, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'createFile', [path, content]);
  },
  rename: function (oldpath, newpath, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'rename', [oldpath, newpath]);
  },
  pwd: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'pwd', []);
  },
  close: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'close', []);
  },
  isConnected: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'isConnected', []);
  },
  openShellUsingPassword: function (host, port, username, password, cols, rows, onEvent, onFail) {
    cordova.exec(onEvent, onFail, 'Sftp', 'openShellUsingPassword', [host, port, username, password, cols, rows]);
  },
  openShellUsingKeyFile: function (host, port, username, keyFile, passphrase, cols, rows, onEvent, onFail) {
    cordova.exec(onEvent, onFail, 'Sftp', 'openShellUsingKeyFile', [host, port, username, keyFile, passphrase, cols, rows]);
  },
  openShellUsingProfile: function (profileId, cols, rows, onEvent, onFail) {
    cordova.exec(onEvent, onFail, 'Sftp', 'openShellUsingProfile', [profileId, cols, rows]);
  },
  writeShell: function (sessionId, data, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'writeShell', [sessionId, data]);
  },
  resizeShell: function (sessionId, cols, rows, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'resizeShell', [sessionId, cols, rows]);
  },
  closeShell: function (sessionId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'closeShell', [sessionId]);
  }
};
