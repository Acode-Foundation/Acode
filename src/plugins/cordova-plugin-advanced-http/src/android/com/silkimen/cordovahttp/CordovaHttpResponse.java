package com.silkimen.cordovahttp;

import java.nio.ByteBuffer;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.json.JSONException;
import org.json.JSONObject;

import android.text.TextUtils;
import android.util.Log;
import android.util.Base64;

class CordovaHttpResponse {
  private int status;
  private String url;
  private Map<String, List<String>> headers;
  private String body;
  private byte[] rawData;
  private JSONObject fileEntry;
  private boolean hasFailed;
  private boolean isFileOperation;
  private boolean isRawResponse;
  private String error;

  public void setStatus(int status) {
    this.status = status;
  }

  public void setUrl(String url) {
    this.url = url;
  }

  public void setHeaders(Map<String, List<String>> headers) {
    this.headers = headers;
  }

  public void setBody(String body) {
    this.body = body;
  }

  public void setData(byte[] rawData) {
    this.isRawResponse = true;
    this.rawData = rawData;
  }

  public void setFileEntry(JSONObject entry) {
    this.isFileOperation = true;
    this.fileEntry = entry;
  }

  public void setErrorMessage(String message) {
    this.hasFailed = true;
    this.error = message;
  }

  public boolean hasFailed() {
    return this.hasFailed;
  }

  public JSONObject toJSON() throws JSONException {
    JSONObject json = new JSONObject();

    json.put("status", this.status);
    json.put("url", this.url);

    if (this.headers != null && !this.headers.isEmpty()) {
      json.put("headers", new JSONObject(getFilteredHeaders()));
    }

    if (this.hasFailed) {
      json.put("error", this.error);
    } else if (this.isFileOperation) {
      json.put("file", this.fileEntry);
    } else if (this.isRawResponse) {
      json.put("data", Base64.encodeToString(this.rawData, Base64.DEFAULT));
    } else {
      json.put("data", this.body);
    }

    return json;
  }

  private Map<String, String> getFilteredHeaders() throws JSONException {
    Map<String, String> filteredHeaders = new HashMap<String, String>();

    for (Map.Entry<String, List<String>> entry : this.headers.entrySet()) {
      String key = entry.getKey();
      List<String> value = entry.getValue();

      if ((key != null) && (!value.isEmpty())) {
        filteredHeaders.put(key.toLowerCase(), TextUtils.join(", ", value));
      }
    }

    return filteredHeaders;
  }
}
