package com.foxdebug.acode.http;

import com.silkimen.http.TLSConfiguration;

import org.json.JSONObject;

class NativeHttpOperation extends NativeHttpBase {
  public NativeHttpOperation(String method, String url, String serializer, Object data, JSONObject headers,
      int connectTimeout, int readTimeout, boolean followRedirects, String responseType, TLSConfiguration tlsConfiguration,
      NativeObservableCallbackContext callbackContext) {

    super(method, url, serializer, data, headers, connectTimeout, readTimeout, followRedirects, responseType, tlsConfiguration,
        callbackContext);
  }

  public NativeHttpOperation(String method, String url, JSONObject headers, int connectTimeout, int readTimeout, boolean followRedirects,
      String responseType, TLSConfiguration tlsConfiguration, NativeObservableCallbackContext callbackContext) {

    super(method, url, headers, connectTimeout, readTimeout, followRedirects, responseType, tlsConfiguration, callbackContext);
  }
}
