module.exports = function init(jsUtil) {
  return {
    parseUrl: parseUrl,
    appendQueryParamsString: appendQueryParamsString,
    serializeQueryParams: serializeQueryParams
  }

  function parseUrl(url) {
    var match = url.match(/^(https?\:)\/\/(([^:\/?#]*)(?:\:([0-9]+))?)([\/]{0,1}[^?#]*)(\?[^#]*|)(#.*|)$/);

    return match && {
        protocol: match[1],
        host: match[2],
        hostname: match[3],
        port: match[4] || '',
        pathname: match[5],
        search: match[6],
        hash: match[7]
    }
  }

  function appendQueryParamsString(url, params) {
    if (!url.length || !params.length) {
      return url;
    }

    var parsed = parseUrl(url);

    return parsed.protocol
      + '//'
      + parsed.host
      + parsed.pathname
      + (parsed.search.length ? parsed.search + '&' + params : '?' + params)
      + parsed.hash;
  }

  function serializeQueryParams(params, encode) {
    return serializeObject('', params, encode);
  }

  function serializeObject(parentKey, object, encode) {
    var parts = [];

    for (var key in object) {
      if (!object.hasOwnProperty(key)) {
        continue;
      }

      var identifier = parentKey.length ? parentKey + '[' + key + ']' : key;

      if (jsUtil.getTypeOf(object[key]) === 'Array') {
        parts.push(serializeArray(identifier, object[key], encode));
        continue;
      } else if (jsUtil.getTypeOf(object[key]) === 'Object') {
        parts.push(serializeObject(identifier, object[key], encode));
        continue;
      }

      parts.push(serializeIdentifier(parentKey, key, encode) + '=' + serializeValue(object[key], encode));
    }

    return parts.join('&');
  }

  function serializeArray(parentKey, array, encode) {
    var parts = [];

    for (var i = 0; i < array.length; ++i) {
      if (jsUtil.getTypeOf(array[i]) === 'Array') {
        parts.push(serializeArray(parentKey + '[]', array[i], encode));
        continue;
      } else if (jsUtil.getTypeOf(array[i]) === 'Object') {
        parts.push(serializeObject(parentKey + '[]' + array[i], encode));
        continue;
      }

      parts.push(serializeIdentifier(parentKey, '', encode) + '=' + serializeValue(array[i], encode));
    }

    return parts.join('&');
  }

  function serializeIdentifier(parentKey, key, encode) {
    if (!parentKey.length) {
      return encode ? encodeURIComponent(key) : key;
    }

    if (encode) {
      return encodeURIComponent(parentKey) + '[' + encodeURIComponent(key) + ']';
    } else {
      return parentKey + '[' + key + ']';
    }
  }

  function serializeValue(value, encode) {
    if (encode) {
      return encodeURIComponent(value);
    } else {
      return value;
    }
  }
};

