var exec = require('cordova/exec');

exports.open = function (url, options, success, error) {
    exec(
        success,
        error,
        'CustomTabs',
        'open',
        [url, options || {}]
    );
};
