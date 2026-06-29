package com.silkimen.cordovahttp;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLSocketFactory;

import com.silkimen.http.TLSConfiguration;

import org.json.JSONObject;

class CordovaHttpOperation extends CordovaHttpBase {
  public CordovaHttpOperation(String method, String url, String serializer, Object data, JSONObject headers,
      int connectTimeout, int readTimeout, boolean followRedirects, String responseType, TLSConfiguration tlsConfiguration,
      CordovaObservableCallbackContext callbackContext) {

    super(method, url, serializer, data, headers, connectTimeout, readTimeout, followRedirects, responseType, tlsConfiguration,
        callbackContext);
  }

  public CordovaHttpOperation(String method, String url, JSONObject headers, int connectTimeout, int readTimeout, boolean followRedirects,
      String responseType, TLSConfiguration tlsConfiguration, CordovaObservableCallbackContext callbackContext) {

    super(method, url, headers, connectTimeout, readTimeout, followRedirects, responseType, tlsConfiguration, callbackContext);
  }
}
