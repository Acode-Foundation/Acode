module.exports = {
  exec: function (command, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'exec', [command]);
  },
  connectUsingProfile: function (profileId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'connectUsingProfile', [profileId]);
  },
  testProfile: function (profileId, requestId, timeout, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'testProfile', [profileId, requestId, timeout]);
  },
  cancelConnection: function (requestId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'cancelConnection', [requestId]);
  },
  saveProfile: function (profileId, host, port, username, authType, password, keyFile, passphrase, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'saveProfile', [profileId, host, port, username, authType, password, keyFile, passphrase]);
  },
  editProfile: function (profileId, host, port, username, authType, password, keyFile, passphrase, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'editProfile', [profileId, host, port, username, authType, password, keyFile, passphrase]);
  },
  getProfileInfo: function (profileId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'getProfileInfo', [profileId]);
  },
  deleteProfile: function (profileId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'deleteProfile', [profileId]);
  },
  getFile: function (filename, localFilename, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'getFile', [filename, localFilename]);
  },
  getFileRange: function (filename, start, end, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Sftp', 'getFileRange', [filename, start, end]);
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
