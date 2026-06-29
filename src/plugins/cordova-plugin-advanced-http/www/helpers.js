module.exports = function init(global, jsUtil, cookieHandler, messages, base64, errorCodes, dependencyValidator, ponyfills) {
  var validSerializers = ['urlencoded', 'json', 'utf8', 'raw', 'multipart'];
  var validCertModes = ['default', 'nocheck', 'pinned', 'legacy'];
  var validClientAuthModes = ['none', 'systemstore', 'buffer'];
  var validHttpMethods = ['get', 'put', 'post', 'patch', 'head', 'delete', 'options', 'upload', 'download'];
  var validResponseTypes = ['text', 'json', 'arraybuffer', 'blob'];

  var nextRequestId = (function(){
    var currReqId = 0;
    return function nextRequestId() {
        return ++currReqId;
    }
  })();

  var interface = {
    b64EncodeUnicode: b64EncodeUnicode,
    checkClientAuthMode: checkClientAuthMode,
    checkClientAuthOptions: checkClientAuthOptions,
    checkDownloadFilePath: checkDownloadFilePath,
    checkFollowRedirectValue: checkFollowRedirectValue,
    checkForBlacklistedHeaderKey: checkForBlacklistedHeaderKey,
    checkForInvalidHeaderValue: checkForInvalidHeaderValue,
    checkSerializer: checkSerializer,
    checkSSLCertMode: checkSSLCertMode,
    checkTimeoutValue: checkTimeoutValue,
    checkUploadFileOptions: checkUploadFileOptions,
    getMergedHeaders: getMergedHeaders,
    processData: processData,
    handleMissingCallbacks: handleMissingCallbacks,
    handleMissingOptions: handleMissingOptions,
    injectCookieHandler: injectCookieHandler,
    injectFileEntryHandler: injectFileEntryHandler,
    injectRawResponseHandler: injectRawResponseHandler,
    nextRequestId: nextRequestId,
  };

  // expose all functions for testing purposes
  if (init.debug) {
    interface.mergeHeaders = mergeHeaders;
    interface.checkForValidStringValue = checkForValidStringValue;
    interface.checkKeyValuePairObject = checkKeyValuePairObject;
    interface.checkHttpMethod = checkHttpMethod;
    interface.checkResponseType = checkResponseType;
    interface.checkHeadersObject = checkHeadersObject;
    interface.checkParamsObject = checkParamsObject;
    interface.resolveCookieString = resolveCookieString;
    interface.createFileEntry = createFileEntry;
    interface.getCookieHeader = getCookieHeader;
    interface.getMatchingHostHeaders = getMatchingHostHeaders;
    interface.getAllowedDataTypes = getAllowedDataTypes;
  }

  return interface;

  // Thanks Mozilla: https://developer.mozilla.org/en-US/docs/Web/API/WindowBase64/Base64_encoding_and_decoding#The_.22Unicode_Problem.22
  function b64EncodeUnicode(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
      return String.fromCharCode('0x' + p1);
    }));
  }

  function mergeHeaders(globalHeaders, localHeaders) {
    var globalKeys = Object.keys(globalHeaders);
    var key;

    for (var i = 0; i < globalKeys.length; i++) {
      key = globalKeys[i];

      if (!localHeaders.hasOwnProperty(key)) {
        localHeaders[key] = globalHeaders[key];
      }
    }

    return localHeaders;
  }

  function checkForValidStringValue(list, value, onInvalidValueMessage) {
    if (jsUtil.getTypeOf(value) !== 'String') {
      throw new Error(onInvalidValueMessage + ' ' + list.join(', '));
    }

    value = value.trim().toLowerCase();

    if (list.indexOf(value) === -1) {
      throw new Error(onInvalidValueMessage + ' ' + list.join(', '));
    }

    return value;
  }

  function checkKeyValuePairObject(obj, allowedChildren, onInvalidValueMessage) {
    if (jsUtil.getTypeOf(obj) !== 'Object') {
      throw new Error(onInvalidValueMessage);
    }

    var keys = Object.keys(obj);

    for (var i = 0; i < keys.length; i++) {
      if (allowedChildren.indexOf(jsUtil.getTypeOf(obj[keys[i]])) === -1) {
        throw new Error(onInvalidValueMessage);
      }
    }

    return obj;
  }

  function checkArray(array, allowedDataTypes, onInvalidValueMessage) {
    if (jsUtil.getTypeOf(array) !== 'Array') {
      throw new Error(onInvalidValueMessage);
    }

    for (var i = 0; i < array.length; ++i) {
      if (allowedDataTypes.indexOf(jsUtil.getTypeOf(array[i])) === -1) {
        throw new Error(onInvalidValueMessage);
      }
    }

    return array;
  }

  function checkHttpMethod(method) {
    return checkForValidStringValue(validHttpMethods, method, messages.INVALID_HTTP_METHOD);
  }

  function checkResponseType(type) {
    return checkForValidStringValue(validResponseTypes, type, messages.INVALID_RESPONSE_TYPE);
  }

  function checkSerializer(serializer) {
    return checkForValidStringValue(validSerializers, serializer, messages.INVALID_DATA_SERIALIZER);
  }

  function checkSSLCertMode(mode) {
    return checkForValidStringValue(validCertModes, mode, messages.INVALID_SSL_CERT_MODE);
  }

  function checkClientAuthMode(mode) {
    return checkForValidStringValue(validClientAuthModes, mode, messages.INVALID_CLIENT_AUTH_MODE);
  }

  function checkClientAuthOptions(mode, options) {
    options = options || {};

    // none
    if (mode === validClientAuthModes[0]) {
      return {
        alias: null,
        rawPkcs: null,
        pkcsPassword: ''
      };
    }

    if (jsUtil.getTypeOf(options) !== 'Object') {
      throw new Error(messages.INVALID_CLIENT_AUTH_OPTIONS);
    }

    // systemstore
    if (mode === validClientAuthModes[1]) {
      if (jsUtil.getTypeOf(options.alias) !== 'String'
        && jsUtil.getTypeOf(options.alias) !== 'Undefined') {
        throw new Error(messages.INVALID_CLIENT_AUTH_ALIAS);
      }

      return {
        alias: jsUtil.getTypeOf(options.alias) === 'Undefined' ? null : options.alias,
        rawPkcs: null,
        pkcsPassword: ''
      };
    }

    // buffer
    if (mode === validClientAuthModes[2]) {
      if (jsUtil.getTypeOf(options.rawPkcs) !== 'ArrayBuffer') {
        throw new Error(messages.INVALID_CLIENT_AUTH_RAW_PKCS);
      }

      if (jsUtil.getTypeOf(options.pkcsPassword) !== 'String') {
        throw new Error(messages.INVALID_CLIENT_AUTH_PKCS_PASSWORD);
      }

      return {
        alias: null,
        rawPkcs: options.rawPkcs,
        pkcsPassword: options.pkcsPassword
      }
    }
  }

  function checkForBlacklistedHeaderKey(key) {
    if (key.toLowerCase() === 'cookie') {
      throw new Error(messages.ADDING_COOKIES_NOT_SUPPORTED);
    }

    return key;
  }

  function checkForInvalidHeaderValue(value) {
    var type = jsUtil.getTypeOf(value);

    if (type !== 'String' && type !== 'Null') {
      throw new Error(messages.INVALID_HEADER_VALUE);
    }

    return value;
  }

  function checkTimeoutValue(timeout) {
    if (jsUtil.getTypeOf(timeout) !== 'Number' || timeout < 0) {
      throw new Error(messages.INVALID_TIMEOUT_VALUE);
    }

    return timeout;
  }

  function checkFollowRedirectValue(follow) {
    if (jsUtil.getTypeOf(follow) !== 'Boolean') {
      throw new Error(messages.INVALID_FOLLOW_REDIRECT_VALUE);
    }

    return follow;
  }

  function checkHeadersObject(headers) {
    return checkKeyValuePairObject(headers, ['String'], messages.TYPE_MISMATCH_HEADERS);
  }

  function checkParamsObject(params) {
    return checkKeyValuePairObject(params, ['String', 'Array'], messages.TYPE_MISMATCH_PARAMS);
  }

  function checkDownloadFilePath(filePath) {
    if (!filePath || jsUtil.getTypeOf(filePath) !== 'String') {
      throw new Error(messages.INVALID_DOWNLOAD_FILE_PATH);
    }

    return filePath;
  }

  function checkUploadFileOptions(filePaths, names) {
    if (jsUtil.getTypeOf(filePaths) === 'String') {
      filePaths = [filePaths];
    }

    if (jsUtil.getTypeOf(names) === 'String') {
      names = [names];
    }

    var opts = {
      filePaths: checkArray(filePaths, ['String'], messages.TYPE_MISMATCH_FILE_PATHS),
      names: checkArray(names, ['String'], messages.TYPE_MISMATCH_NAMES)
    };

    if (!opts.filePaths.length) {
      throw new Error(messages.EMPTY_FILE_PATHS);
    }

    if (!opts.names.length) {
      throw new Error(messages.EMPTY_NAMES);
    }

    return opts;
  }

  function resolveCookieString(headers) {
    var keys = Object.keys(headers || {});

    for (var i = 0; i < keys.length; ++i) {
      if (keys[i].match(/^set-cookie$/i)) {
        return headers[keys[i]];
      }
    }

    return null;
  }

  function createFileEntry(rawEntry) {
    var entry = new (require('cordova-plugin-file.FileEntry'))();

    entry.isDirectory = rawEntry.isDirectory;
    entry.isFile = rawEntry.isFile;
    entry.name = rawEntry.name;
    entry.fullPath = rawEntry.fullPath;
    entry.filesystem = new FileSystem(rawEntry.filesystemName || (rawEntry.filesystem == global.PERSISTENT ? 'persistent' : 'temporary'));
    entry.nativeURL = rawEntry.nativeURL;

    return entry;
  }

  function injectCookieHandler(url, cb) {
    return function (response) {
      cookieHandler.setCookieFromString(url, resolveCookieString(response.headers));
      cb(response);
    }
  }

  function injectRawResponseHandler(responseType, success, failure) {
    return function (response) {
      var dataType = jsUtil.getTypeOf(response.data);

      // don't need post-processing if it's already binary type (on browser platform)
      if (dataType === 'ArrayBuffer' || dataType === 'Blob') {
        return success(response);
      }

      try {
        // json
        if (responseType === validResponseTypes[1]) {
          response.data = response.data === ''
            ? undefined
            : JSON.parse(response.data);
        }

        // arraybuffer
        else if (responseType === validResponseTypes[2]) {
          response.data = response.data === ''
            ? null
            : base64.toArrayBuffer(response.data);
        }

        // blob
        else if (responseType === validResponseTypes[3]) {
          if (response.data === '') {
            response.data = null;
          } else {
            var buffer = base64.toArrayBuffer(response.data);
            var type = response.headers['content-type'] || '';
            var blob = new Blob([buffer], { type: type });
            response.data = blob;
          }
        }

        success(response);
      } catch (error) {
        failure({
          status: errorCodes.POST_PROCESSING_FAILED,
          error: messages.POST_PROCESSING_FAILED + ' ' + error.message,
          url: response.url,
          headers: response.headers
        });
      }
    }
  }

  function injectFileEntryHandler(cb) {
    return function (response) {
      var fileEntry = createFileEntry(response.file);
      response.file = fileEntry;
      response.data = fileEntry;
      cb(fileEntry, response);
    }
  }

  function getCookieHeader(url) {
    var cookieString = cookieHandler.getCookieString(url);

    if (cookieString.length) {
      return { Cookie: cookieHandler.getCookieString(url) };
    }

    return {};
  }

  function getMatchingHostHeaders(url, headersList) {
    var matches = url.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
    var domain = matches && matches[1];

    return headersList[domain] || null;
  }

  function getMergedHeaders(url, requestHeaders, predefinedHeaders) {
    var globalHeaders = predefinedHeaders['*'] || {};
    var hostHeaders = getMatchingHostHeaders(url, predefinedHeaders) || {};
    var mergedHeaders = mergeHeaders(globalHeaders, hostHeaders);

    mergedHeaders = mergeHeaders(mergedHeaders, requestHeaders);
    mergedHeaders = mergeHeaders(mergedHeaders, getCookieHeader(url));

    return mergedHeaders;
  }

  function getAllowedDataTypes(dataSerializer) {
    switch (dataSerializer) {
      case 'utf8':
        return ['String'];
      case 'urlencoded':
        return ['Object'];
      case 'json':
        return ['Array', 'Object'];
      case 'raw':
        return ['Uint8Array', 'ArrayBuffer'];
      default:
        return [];
    }
  }

  function getAllowedInstanceTypes(dataSerializer) {
    return dataSerializer === 'multipart' ? ['FormData'] : null;
  }

  function processData(data, dataSerializer, cb) {
    var currentDataType = jsUtil.getTypeOf(data);
    var allowedDataTypes = getAllowedDataTypes(dataSerializer);
    var allowedInstanceTypes = getAllowedInstanceTypes(dataSerializer);

    if (allowedInstanceTypes) {
      var isCorrectInstanceType = false;

      allowedInstanceTypes.forEach(function (type) {
        if ((global[type] && data instanceof global[type]) || (ponyfills[type] && data instanceof ponyfills[type])) {
          isCorrectInstanceType = true;
        }
      });

      if (!isCorrectInstanceType) {
        throw new Error(messages.INSTANCE_TYPE_MISMATCH_DATA + ' ' + allowedInstanceTypes.join(', '));
      }
    }

    if (!allowedInstanceTypes && allowedDataTypes.indexOf(currentDataType) === -1) {
      throw new Error(messages.TYPE_MISMATCH_DATA + ' ' + allowedDataTypes.join(', '));
    }

    switch (dataSerializer) {
      case 'utf8':
        return cb({ text: data });
      case 'raw':
        return cb(currentDataType === 'Uint8Array' ? data.buffer : data);
      case 'multipart':
        return processFormData(data, cb);
      default:
        return cb(data);
    }
  }

  function processFormData(data, cb) {
    dependencyValidator.checkBlobApi();
    dependencyValidator.checkFileReaderApi();
    dependencyValidator.checkTextEncoderApi();
    dependencyValidator.checkFormDataInstance(data);

    var textEncoder = new global.TextEncoder('utf8');
    var iterator = data.entries();

    var result = {
      buffers: [],
      names: [],
      fileNames: [],
      types: []
    };

    processFormDataIterator(iterator, textEncoder, result, cb);
  }

  function processFormDataIterator(iterator, textEncoder, result, onFinished) {
    var entry = iterator.next();

    if (entry.done) {
      return onFinished(result);
    }

    if (entry.value[1] instanceof global.Blob || entry.value[1] instanceof global.File) {
      var reader = new global.FileReader();

      reader.onload = function () {
        result.buffers.push(base64.fromArrayBuffer(reader.result));
        result.names.push(entry.value[0]);
        result.fileNames.push(entry.value[1].name !== undefined ? entry.value[1].name : 'blob');
        result.types.push(entry.value[1].type || '');
        processFormDataIterator(iterator, textEncoder, result, onFinished);
      };

      return reader.readAsArrayBuffer(entry.value[1]);
    }

    if (jsUtil.getTypeOf(entry.value[1]) === 'String') {
      result.buffers.push(base64.fromArrayBuffer(textEncoder.encode(entry.value[1]).buffer));
      result.names.push(entry.value[0]);
      result.fileNames.push(null);
      result.types.push('text/plain');

      return processFormDataIterator(iterator, textEncoder, result, onFinished)
    }

    // skip items which are not supported
    processFormDataIterator(iterator, textEncoder, result, onFinished);
  }

  function handleMissingCallbacks(successFn, failFn) {
    if (jsUtil.getTypeOf(successFn) !== 'Function') {
      throw new Error(messages.MANDATORY_SUCCESS);
    }

    if (jsUtil.getTypeOf(failFn) !== 'Function') {
      throw new Error(messages.MANDATORY_FAIL);
    }
  }

  function handleMissingOptions(options, globals) {
    options = options || {};

    return {
      data: jsUtil.getTypeOf(options.data) === 'Undefined' ? null : options.data,
      filePath: options.filePath,
      followRedirect: checkFollowRedirectValue(options.followRedirect || globals.followRedirect),
      headers: checkHeadersObject(options.headers || {}),
      method: checkHttpMethod(options.method || validHttpMethods[0]),
      name: options.name,
      params: checkParamsObject(options.params || {}),
      responseType: checkResponseType(options.responseType || validResponseTypes[0]),
      serializer: checkSerializer(options.serializer || globals.serializer),
      connectTimeout: checkTimeoutValue(options.connectTimeout || globals.connectTimeout),
      readTimeout: checkTimeoutValue(options.readTimeout || globals.readTimeout),
      timeout: checkTimeoutValue(options.timeout || globals.timeout)
    };
  }
};
