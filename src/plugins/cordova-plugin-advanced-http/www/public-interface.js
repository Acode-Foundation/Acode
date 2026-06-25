module.exports = function init(exec, cookieHandler, urlUtil, helpers, globalConfigs, errorCodes, ponyfills) {
  var publicInterface = {
    getBasicAuthHeader: getBasicAuthHeader,
    useBasicAuth: useBasicAuth,
    getHeaders: getHeaders,
    setHeader: setHeader,
    getDataSerializer: getDataSerializer,
    setDataSerializer: setDataSerializer,
    setCookie: setCookie,
    clearCookies: clearCookies,
    removeCookies: removeCookies,
    getCookieString: getCookieString,
    getRequestTimeout: getRequestTimeout,
    setRequestTimeout: setRequestTimeout,
    getFollowRedirect: getFollowRedirect,
    setFollowRedirect: setFollowRedirect,
    // @Android Only
    getConnectTimeout: getConnectTimeout,
    // @Android Only
    setConnectTimeout: setConnectTimeout,
    getReadTimeout: getReadTimeout,
    setReadTimeout: setReadTimeout,
    setServerTrustMode: setServerTrustMode,
    setClientAuthMode: setClientAuthMode,
    sendRequest: sendRequest,
    post: post,
    put: put,
    patch: patch,
    get: get,
    delete: del,
    head: head,
    options: options,
    uploadFile: uploadFile,
    downloadFile: downloadFile,
    abort: abort,
    ErrorCode: errorCodes,
    ponyfills: ponyfills
  };

  function getBasicAuthHeader(username, password) {
    return { 'Authorization': 'Basic ' + helpers.b64EncodeUnicode(username + ':' + password) };
  }

  function useBasicAuth(username, password) {
    this.setHeader('*', 'Authorization', 'Basic ' + helpers.b64EncodeUnicode(username + ':' + password));
  }

  function getHeaders(host) {
    return globalConfigs.headers[host || '*'] || null;
  }

  function setHeader() {
    // this one is for being backward compatible
    var host = '*';
    var header = arguments[0];
    var value = arguments[1];

    if (arguments.length === 3) {
      host = arguments[0];
      header = arguments[1];
      value = arguments[2];
    }

    helpers.checkForBlacklistedHeaderKey(header);
    helpers.checkForInvalidHeaderValue(value);

    globalConfigs.headers[host] = globalConfigs.headers[host] || {};

    if (value === null) {
      delete globalConfigs.headers[host][header];
    } else {
      globalConfigs.headers[host][header] = value;
    }
  }

  function getDataSerializer() {
    return globalConfigs.serializer;
  }

  function setDataSerializer(serializer) {
    globalConfigs.serializer = helpers.checkSerializer(serializer);
  }

  function setCookie(url, cookie, options) {
    cookieHandler.setCookie(url, cookie, options);
  }

  function clearCookies() {
    cookieHandler.clearCookies();
  }

  function removeCookies(url, callback) {
    cookieHandler.removeCookies(url, callback);
  }

  function getCookieString(url) {
    return cookieHandler.getCookieString(url);
  }

  function getRequestTimeout() {
    return globalConfigs.timeout;
  }

  function setRequestTimeout(timeout) {
    globalConfigs.timeout = helpers.checkTimeoutValue(timeout);
    globalConfigs.connectTimeout = helpers.checkTimeoutValue(timeout);
    globalConfigs.readTimeout = helpers.checkTimeoutValue(timeout);
  }

  function getConnectTimeout() {
    return globalConfigs.connectTimeout;
  }

  function setConnectTimeout(timeout) {
    globalConfigs.connectTimeout = helpers.checkTimeoutValue(timeout);
  }

  function getReadTimeout() {
    return globalConfigs.readTimeout;
  }

  function setReadTimeout(timeout) {
    globalConfigs.readTimeout = helpers.checkTimeoutValue(timeout);
  }

  function getFollowRedirect() {
    return globalConfigs.followRedirect;
  }

  function setFollowRedirect(follow) {
    globalConfigs.followRedirect = helpers.checkFollowRedirectValue(follow);
  }

  function setServerTrustMode(mode, success, failure) {
    helpers.handleMissingCallbacks(success, failure);

    return exec(success, failure, 'CordovaHttpPlugin', 'setServerTrustMode', [helpers.checkSSLCertMode(mode)]);
  }

  function setClientAuthMode() {
    var mode = arguments[0];
    var options = null;
    var success = arguments[1];
    var failure = arguments[2];

    if (arguments.length === 4) {
      options = arguments[1];
      success = arguments[2];
      failure = arguments[3];
    }

    mode = helpers.checkClientAuthMode(mode);
    options = helpers.checkClientAuthOptions(mode, options);

    helpers.handleMissingCallbacks(success, failure);

    return exec(success, failure, 'CordovaHttpPlugin', 'setClientAuthMode', [mode, options.alias, options.rawPkcs, options.pkcsPassword]);
  }

  function sendRequest(url, options, success, failure) {
    helpers.handleMissingCallbacks(success, failure);

    options = helpers.handleMissingOptions(options, globalConfigs);
    url = urlUtil.appendQueryParamsString(url, urlUtil.serializeQueryParams(options.params, true));

    var headers = helpers.getMergedHeaders(url, options.headers, globalConfigs.headers);

    var onFail = helpers.injectCookieHandler(url, failure);
    var onSuccess = helpers.injectCookieHandler(url, helpers.injectRawResponseHandler(options.responseType, success, failure));

    var reqId = helpers.nextRequestId();

    switch (options.method) {
      case 'post':
      case 'put':
      case 'patch':
        helpers.processData(options.data, options.serializer, function (data) {
          exec(onSuccess, onFail, 'CordovaHttpPlugin', options.method, [url, data, options.serializer, headers, options.connectTimeout, options.readTimeout, options.followRedirect, options.responseType, reqId]);
        });
        break;
      case 'upload':
        var fileOptions = helpers.checkUploadFileOptions(options.filePath, options.name);
        exec(onSuccess, onFail, 'CordovaHttpPlugin', 'uploadFiles', [url, headers, fileOptions.filePaths, fileOptions.names, options.connectTimeout, options.readTimeout, options.followRedirect, options.responseType, reqId]);
        break;
      case 'download':
        var filePath = helpers.checkDownloadFilePath(options.filePath);
        var onDownloadSuccess = helpers.injectCookieHandler(url, helpers.injectFileEntryHandler(success));
        exec(onDownloadSuccess, onFail, 'CordovaHttpPlugin', 'downloadFile', [url, headers, filePath, options.connectTimeout, options.readTimeout, options.followRedirect, reqId]);
        break;
      default:
        exec(onSuccess, onFail, 'CordovaHttpPlugin', options.method, [url, headers, options.connectTimeout, options.readTimeout, options.followRedirect, options.responseType, reqId]);
        break;
    }

    return reqId;
  }

  function post(url, data, headers, success, failure) {
    return publicInterface.sendRequest(url, { method: 'post', data: data, headers: headers }, success, failure);
  };

  function put(url, data, headers, success, failure) {
    return publicInterface.sendRequest(url, { method: 'put', data: data, headers: headers }, success, failure);
  }

  function patch(url, data, headers, success, failure) {
    return publicInterface.sendRequest(url, { method: 'patch', data: data, headers: headers }, success, failure);
  }

  function get(url, params, headers, success, failure) {
    return publicInterface.sendRequest(url, { method: 'get', params: params, headers: headers }, success, failure);
  };

  function del(url, params, headers, success, failure) {
    return publicInterface.sendRequest(url, { method: 'delete', params: params, headers: headers }, success, failure);
  }

  function head(url, params, headers, success, failure) {
    return publicInterface.sendRequest(url, { method: 'head', params: params, headers: headers }, success, failure);
  }

  function options(url, params, headers, success, failure) {
    return publicInterface.sendRequest(url, { method: 'options', params: params, headers: headers }, success, failure);
  };

  function uploadFile(url, params, headers, filePath, name, success, failure) {
    return publicInterface.sendRequest(url, { method: 'upload', params: params, headers: headers, filePath: filePath, name: name }, success, failure);
  }

  function downloadFile(url, params, headers, filePath, success, failure) {
    return publicInterface.sendRequest(url, { method: 'download', params: params, headers: headers, filePath: filePath }, success, failure);
  }

  function abort(requestId , success, failure) {
    return exec(success, failure, 'CordovaHttpPlugin', 'abort', [requestId]);
  }

  return publicInterface;
}
