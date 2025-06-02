function exec(cmd,success,failure) {
  const ACTION = 'exec';
  cordova.exec(success, failure, 'Executor', ACTION, [cmd]);
}

export default {
  exec,
};