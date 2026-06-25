module.exports = function init(storage, ToughCookie, WebStorageCookieStore) {
  var storeKey = '__advancedHttpCookieStore__';

  var store = new WebStorageCookieStore(storage, storeKey);
  var cookieJar = new ToughCookie.CookieJar(store);

  return {
    setCookieFromString: setCookieFromString,
    setCookie: setCookie,
    getCookieString: getCookieString,
    clearCookies: clearCookies,
    removeCookies: removeCookies
  };

  function splitCookieString(cookieStr) {
    var cookieParts = cookieStr.split(',');
    var splitCookies = [];
    var processedCookie = null;

    for (var i = 0; i < cookieParts.length; ++i) {
      if (cookieParts[i].substr(-11, 8).toLowerCase() === 'expires=') {
        processedCookie = cookieParts[i] + ',' + cookieParts[i + 1];
        i++;
      } else {
        processedCookie = cookieParts[i];
      }

      processedCookie = processedCookie.trim();
      splitCookies.push(processedCookie);
    }

    return splitCookies;
  }

  function setCookieFromString(url, cookieStr) {
    if (!cookieStr) return;

    var cookies = splitCookieString(cookieStr);

    for (var i = 0; i < cookies.length; ++i) {
      cookieJar.setCookieSync(cookies[i], url, { ignoreError: true });
    }
  }

  function setCookie(url, cookie, options) {
    options = options || {};
    options.ignoreError = false;
    cookieJar.setCookieSync(cookie, url, options);
  }

  function getCookieString(url) {
    return cookieJar.getCookieStringSync(url);
  }

  function clearCookies() {
    window.localStorage.removeItem(storeKey);
  }

  function removeCookies(url, cb) {
    cookieJar.getCookies(url, function (error, cookies) {
      if (!cookies || cookies.length === 0) {
        return cb(null, []);
      }

      var domain = cookies[0].domain;

      cookieJar.store.removeCookies(domain, null, cb);
    });
  }
};
