package com.foxdebug.acode.http;

import java.io.File;
import java.net.URI;

import com.silkimen.http.HttpRequest;
import com.silkimen.http.TLSConfiguration;

import com.foxdebug.acode.file.FileUtils;
import org.json.JSONObject;

class NativeHttpDownload extends NativeHttpBase {
  private String filePath;

  public NativeHttpDownload(String url, JSONObject headers, String filePath, int connectTimeout, int readTimeout,
      boolean followRedirects, TLSConfiguration tlsConfiguration, NativeObservableCallbackContext callbackContext) {

    super("GET", url, headers, connectTimeout, readTimeout, followRedirects, "text", tlsConfiguration, callbackContext);
    this.filePath = filePath;
  }

  @Override
  protected void processResponse(HttpRequest request, NativeHttpResponse response) throws Exception {
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
