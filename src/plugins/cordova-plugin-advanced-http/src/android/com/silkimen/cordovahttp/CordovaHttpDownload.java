package com.silkimen.cordovahttp;

import java.io.File;
import java.net.URI;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLSocketFactory;

import com.silkimen.http.HttpRequest;
import com.silkimen.http.TLSConfiguration;

import org.apache.cordova.file.FileUtils;
import org.json.JSONObject;

class CordovaHttpDownload extends CordovaHttpBase {
  private String filePath;

  public CordovaHttpDownload(String url, JSONObject headers, String filePath, int connectTimeout, int readTimeout,
      boolean followRedirects, TLSConfiguration tlsConfiguration, CordovaObservableCallbackContext callbackContext) {

    super("GET", url, headers, connectTimeout, readTimeout, followRedirects, "text", tlsConfiguration, callbackContext);
    this.filePath = filePath;
  }

  @Override
  protected void processResponse(HttpRequest request, CordovaHttpResponse response) throws Exception {
    response.setStatus(request.code());
    response.setUrl(request.url().toString());
    response.setHeaders(request.headers());

    if (request.code() >= 200 && request.code() < 300) {
      File file = new File(new URI(this.filePath));
      JSONObject fileEntry = FileUtils.getFilePlugin().getEntryForFile(file);

      request.receive(file);
      response.setFileEntry(fileEntry);
    } else {
      response.setErrorMessage("There was an error downloading the file");
    }
  }
}
