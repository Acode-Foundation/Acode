var exec = require('cordova/exec');

module.exports.execute = function (cmd,success,failure) {
    exec(success, failure, 'Executor', 'exec', [cmd]);
}