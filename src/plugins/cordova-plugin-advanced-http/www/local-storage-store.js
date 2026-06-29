/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 Exponent
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Based on "tough-cookie-web-storage-store" v1.0.0
 * Thanks James Ide: https://github.com/exponentjs/tough-cookie-web-storage-store
 *
 * Modified by Sefa Ilkimen for cordova plugin integration
 *
 */

'use strict';

module.exports = function init(ToughCookie, _) {
  function WebStorageCookieStore(storage, storeKey) {
    ToughCookie.Store.call(this);
    this._storage = storage;
    this._storeKey = storeKey || '__cookieStore__';
    this.synchronous = true;
  }

  WebStorageCookieStore.prototype = Object.create(ToughCookie.Store);

  WebStorageCookieStore.prototype.findCookie = function (domain, path, key, callback) {
    var store = this._readStore();
    var cookie = _.get(store, [domain, path, key], null);

    callback(null, ToughCookie.Cookie.fromJSON(cookie));
  };

  WebStorageCookieStore.prototype.findCookies = function (domain, path, callback) {
    if (!domain) {
      callback(null, []);
      return;
    }

    var that = this;
    var cookies = [];
    var store = this._readStore();
    var domains = ToughCookie.permuteDomain(domain) || [domain];

    domains.forEach(function (domain) {
      if (!store[domain]) {
        return;
      }

      var matchingPaths = Object.keys(store[domain]);

      if (path != null) {
        matchingPaths = matchingPaths.filter(function (cookiePath) {
          return that._isOnPath(cookiePath, path);
        });
      }

      matchingPaths.forEach(function (path) {
        Array.prototype.push.apply(cookies, _.values(store[domain][path]));
      });
    });

    cookies = cookies.map(function (cookie) {
      return ToughCookie.Cookie.fromJSON(cookie);
    });

    callback(null, cookies);
  };

  /**
   * Returns whether `cookiePath` is on the given `urlPath`
   */
  WebStorageCookieStore.prototype._isOnPath = function (cookiePath, urlPath) {
    if (!cookiePath) {
      return false;
    }

    if (cookiePath === urlPath) {
      return true;
    }

    if (urlPath.indexOf(cookiePath) !== 0) {
      return false;
    }

    if (cookiePath[cookiePath.length - 1] !== '/' && urlPath[cookiePath.length] !== '/') {
      return false;
    }

    return true;
  };

  WebStorageCookieStore.prototype.putCookie = function (cookie, callback) {
    var store = this._readStore();

    _.set(store, [cookie.domain, cookie.path, cookie.key], cookie);
    this._writeStore(store);
    callback(null);
  };

  WebStorageCookieStore.prototype.updateCookie = function (oldCookie, newCookie, callback) {
    this.putCookie(newCookie, callback);
  };


  WebStorageCookieStore.prototype.removeCookie = function (domain, path, key, callback) {
    var store = this._readStore();

    _.unset(store, [domain, path, key]);
    this._writeStore(store);
    callback(null);
  };

  WebStorageCookieStore.prototype.removeCookies = function (domain, path, callback) {
    var store = this._readStore();

    if (path == null) {
      _.unset(store, [domain]);
    } else {
      _.unset(store, [domain, path]);
    }

    this._writeStore(store);
    callback(null);
  };

  WebStorageCookieStore.prototype.getAllCookies = function (callback) {
    var cookies = [];
    var store = this._readStore();

    Object.keys(store).forEach(function (domain) {
      Object.keys(store[domain]).forEach(function (path) {
        Array.prototype.push.apply(cookies, _.values(store[domain][path]));
      });
    });

    cookies = cookies.map(function (cookie) {
      return ToughCookie.Cookie.fromJSON(cookie);
    });

    cookies.sort(function (c1, c2) {
      return (c1.creationIndex || 0) - (c2.creationIndex || 0);
    });

    callback(null, cookies);
  };

  WebStorageCookieStore.prototype._readStore = function () {
    var json = this._storage.getItem(this._storeKey);

    if (json !== null) {
      try {
        return JSON.parse(json);
      } catch (e) { }
    }

    return {};
  };

  WebStorageCookieStore.prototype._writeStore = function (store) {
    this._storage.setItem(this._storeKey, JSON.stringify(store));
  };

  return WebStorageCookieStore;
};
