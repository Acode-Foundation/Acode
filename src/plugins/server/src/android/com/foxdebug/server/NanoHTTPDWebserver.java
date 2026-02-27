package com.foxdebug.server;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import android.util.Log;
import androidx.documentfile.provider.DocumentFile;
import fi.iki.elonen.NanoHTTPD;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.net.URLConnection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.PluginResult;
import org.json.JSONException;
import org.json.JSONObject;

public class NanoHTTPDWebserver extends NanoHTTPD {

  public HashMap<String, Object> responses;
  public CallbackContext onRequestCallbackContext;
  Context context;

  public NanoHTTPDWebserver(int port, Context context) {
    super(port);
    this.context = context;
    this.responses = new HashMap<String, Object>();
  }

  private String getBodyText(IHTTPSession session) {
    Map<String, String> files = new HashMap<String, String>();
    Method method = session.getMethod();
    if (Method.PUT.equals(method) || Method.POST.equals(method)) {
      try {
        session.parseBody(files);
      } catch (IOException ioe) {
        return "{}";
      } catch (ResponseException re) {
        return "{}";
      }
    }
    // get the POST body
    return files.get("postData");
  }

  /**
   * Create a request object
   * <p>
   * [ "requestId": requestUUID, " body": request.jsonObject ?? "", " headers":
   * request.headers, " method": request.method, " path": request.url.path, "
   * query": request.url.query ?? "" ]
   *
   * @param session
   * @return
   */
  private JSONObject createJSONRequest(String requestId, IHTTPSession session)
    throws JSONException {
    JSONObject jsonRequest = new JSONObject();
    jsonRequest.put("requestId", requestId);
    jsonRequest.put("body", this.getBodyText(session));
    jsonRequest.put("headers", session.getHeaders());
    jsonRequest.put("method", session.getMethod());
    jsonRequest.put("path", session.getUri());
    jsonRequest.put("query", session.getQueryParameterString());
    return jsonRequest;
  }

  private String getContentType(JSONObject responseObject)
    throws JSONException {
    if (
      responseObject.has("headers") &&
      responseObject.getJSONObject("headers").has("Content-Type")
    ) {
      return responseObject.getJSONObject("headers").getString("Content-Type");
    } else {
      return "text/plain";
    }
  }

  private Response newFixedFileResponse(DocumentFile file, String mime)
    throws FileNotFoundException, IOException {
    Response res;
    res =
      newFixedLengthResponse(
        Response.Status.OK,
        mime,
        getInputStream(file),
        (int) file.length()
      );
    res.addHeader("Accept-Ranges", "bytes");
    return res;
  }

  Response serveFile(
    Map<String, String> header,
    DocumentFile file,
    String mime
  ) {
    Response res;
    try {
      // Calculate etag
      long fileLen = file.length();
      String path = file.getUri().toString();
      String etag = Integer.toHexString(
        (path + file.lastModified() + "" + fileLen).hashCode()
      );

      // Support (simple) skipping:
      long startFrom = 0;
      long endAt = -1;
      String range = header.get("range");
      if (range != null) {
	        if (range.startsWith("bytes=")) {
	          range = range.substring("bytes=".length());
	          int minus = range.indexOf('-');
	          try {
	            if (minus > 0) {
	              startFrom = Long.parseLong(range.substring(0, minus));
	              endAt = Long.parseLong(range.substring(minus + 1));
	            }
	          } catch (NumberFormatException error) {
	            Log.w("NanoHTTPDWebserver", "Invalid range header: " + range, error);
	          }
	        }
	      }

      // get if-range header. If present, it must match etag or else we
      // should ignore the range request
      String ifRange = header.get("if-range");
      boolean headerIfRangeMissingOrMatching =
        (ifRange == null || etag.equals(ifRange));

      String ifNoneMatch = header.get("if-none-match");
      boolean headerIfNoneMatchPresentAndMatching =
        ifNoneMatch != null &&
        ("*".equals(ifNoneMatch) || ifNoneMatch.equals(etag));

      if (
        headerIfRangeMissingOrMatching &&
        range != null &&
        startFrom >= 0 &&
        startFrom < fileLen
      ) {
        // range request that matches current etag
        // and the startFrom of the range is satisfiable
        if (headerIfNoneMatchPresentAndMatching) {
          // range request that matches current etag
          // and the startFrom of the range is satisfiable
          // would return range from file
          // respond with not-modified
          res = newFixedLengthResponse(Response.Status.NOT_MODIFIED, mime, "");
          res.addHeader("ETag", etag);
        } else {
          if (endAt < 0) {
            endAt = fileLen - 1;
          }
          long newLen = endAt - startFrom + 1;
          if (newLen < 0) {
            newLen = 0;
          }

          InputStream is = getInputStream(file);
          is.skip(startFrom);

          res =
            newFixedLengthResponse(
              Response.Status.PARTIAL_CONTENT,
              mime,
              is,
              newLen
            );
          res.addHeader("Accept-Ranges", "bytes");
          res.addHeader("Content-Length", "" + newLen);

          String contentRange =
            "bytes " + startFrom + "-" + endAt + "/" + fileLen;
          res.addHeader("Content-Range", contentRange);
          res.addHeader("ETag", etag);
        }
      } else {
        if (
          headerIfRangeMissingOrMatching &&
          range != null &&
          startFrom >= fileLen
        ) {
          // return the size of the file
          // 4xx responses are not trumped by if-none-match
          res =
            newFixedLengthResponse(
              Response.Status.RANGE_NOT_SATISFIABLE,
              NanoHTTPD.MIME_PLAINTEXT,
              ""
            );
          res.addHeader("Content-Range", "bytes */" + fileLen);
          res.addHeader("ETag", etag);
        } else if (range == null && headerIfNoneMatchPresentAndMatching) {
          // full-file-fetch request
          // would return entire file
          // respond with not-modified
          res = newFixedLengthResponse(Response.Status.NOT_MODIFIED, mime, "");
          res.addHeader("ETag", etag);
        } else if (
          !headerIfRangeMissingOrMatching && headerIfNoneMatchPresentAndMatching
        ) {
          // range request that doesn't match current etag
          // would return entire (different) file
          // respond with not-modified

          res = newFixedLengthResponse(Response.Status.NOT_MODIFIED, mime, "");
          res.addHeader("ETag", etag);
        } else {
          // supply the file
          res = newFixedFileResponse(file, mime);
          res.addHeader("Content-Length", "" + fileLen);
          res.addHeader("ETag", etag);
        }
      }
    } catch (Exception e) {
      Log.d("ServeFileError", e.getMessage());
      String type = e.getClass().getName();
      if (type.equals("FileNotFoundException")) res =
        newFixedLengthResponse(
          Response.Status.NOT_FOUND,
          NanoHTTPD.MIME_PLAINTEXT,
          e.getMessage()
        ); else res =
        newFixedLengthResponse(
          Response.Status.FORBIDDEN,
          NanoHTTPD.MIME_PLAINTEXT,
          e.getMessage()
        );
    }

    return res;
  }

  @Override
  public Response serve(IHTTPSession session) {
    String requestUUID = UUID.randomUUID().toString();

    PluginResult pluginResult = null;
    try {
      pluginResult =
        new PluginResult(
          PluginResult.Status.OK,
          this.createJSONRequest(requestUUID, session)
        );
    } catch (JSONException e) {
      e.printStackTrace();
    }
    pluginResult.setKeepCallback(true);
    this.onRequestCallbackContext.sendPluginResult(pluginResult);

    while (!this.responses.containsKey(requestUUID)) {
      try {
        Thread.sleep(1);
      } catch (InterruptedException e) {
        e.printStackTrace();
      }
    }

    JSONObject responseObject = (JSONObject) this.responses.get(requestUUID);
    Response response = null;

    if (responseObject.has("path")) {
      try {
        String path = responseObject.getString("path");
        DocumentFile file = getFile(path);
        String mimeType = URLConnection.guessContentTypeFromName(path);
        Response res = serveFile(session.getHeaders(), file, mimeType);
        JSONObject headers = getJSONObject(responseObject, "headers");
        // JSONObject headers = responseObject.getJSONObject("headers");
        if (headers != null) {
          Iterator<String> keys = headers.keys();
          while (keys.hasNext()) {
            String key = (String) keys.next();
            res.addHeader(
              key,
              responseObject.getJSONObject("headers").getString(key)
            );
          }
        }
        return res;
      } catch (JSONException e) {
        e.printStackTrace();
      }
      return response;
    } else {
      try {
        response =
          newFixedLengthResponse(
            Response.Status.lookup(responseObject.getInt("status")),
            getContentType(responseObject),
            responseObject.getString("body")
          );

        Iterator<?> keys = responseObject.getJSONObject("headers").keys();
        while (keys.hasNext()) {
          String key = (String) keys.next();
          response.addHeader(
            key,
            responseObject.getJSONObject("headers").getString(key)
          );
        }
      } catch (JSONException e) {
        e.printStackTrace();
      }
      return response;
    }
  }

  private DocumentFile getFile(String filePath) {
    Uri fileUri = Uri.parse(filePath);
    DocumentFile documentFile = null;
    if (filePath.matches("file:///(.*)")) {
      File file = new File(fileUri.getPath());
      documentFile = DocumentFile.fromFile(file);
    } else {
      documentFile =
        DocumentFile.fromSingleUri(this.context, Uri.parse(filePath));
    }

    return documentFile;
  }

  private InputStream getInputStream(DocumentFile file)
    throws FileNotFoundException, IOException {
    Uri uri = file.getUri();
    ContentResolver contentResolver = context.getContentResolver();
    return contentResolver.openInputStream(uri);
  }

  private JSONObject getJSONObject(JSONObject ob, String key) {
    JSONObject jsonObject = null;
    try {
      jsonObject = ob.getJSONObject(key);
    } catch (JSONException e) {
      Log.w("NanoHTTPDWebserver", "Missing or invalid JSON object for key: " + key, e);
    }
    return jsonObject;
  }
}
