module.exports = function (port, onRequest, onError) {
	cordova.exec(onRequest, onError, "Server", "start", [port]);
	return {
		stop: function (onSuccess, onError) {
			onSuccess = onSuccess || function () {};
			onError = onError || console.error.bind(console);
			cordova.exec(onSuccess, onError, "Server", "stop", [port]);
		},
		send: function (req_id, data, onSuccess, onError) {
			onSuccess = onSuccess || function () {};
			onError = onError || console.error.bind(console);
			cordova.exec(onSuccess, onError, "Server", "send", [port, req_id, data]);
		},
		setOnRequestHandler: function (onRequest, onError) {
			onError = onError || console.error.bind(console);
			cordova.exec(onRequest, onError, "Server", "setOnRequestHandler", [port]);
		},
		port: port,
	};
};
