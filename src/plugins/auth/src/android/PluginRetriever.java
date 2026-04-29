package com.foxdebug.acode.rk.auth;

import android.util.Log;
import org.apache.cordova.CallbackContext;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;
import android.content.Context;
import java.io.File;
import java.io.InputStream;
import java.io.FileOutputStream;

public class PluginRetriever {
    private static final String TAG = "AcodePluginRetriever";
    private static final String SUPPORTED_EDITOR = "cm";

    
    private static String withSupportedEditor(String url) {
        String separator = url.contains("?") ? "&" : "?";
        return url + separator + "supported_editor=" + SUPPORTED_EDITOR;
    }


    public static String fetchWithToken(String urlString, String token) {
        HttpURLConnection conn = null;

        try {
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();

            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            if (token != null && !token.isEmpty()) {
                String host = url.getHost();

                // Only send token to trusted domains
                if (host != null &&
                    (host.equals("acode.app") ||
                    host.endsWith(".acode.app"))) {

                    conn.setRequestProperty("x-auth-token", token);
                } else {
                    Log.w(TAG, "Skipping token for untrusted host: " + host);
                }
            }

            int code = conn.getResponseCode();

            if (code != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "HTTP " + code + " for " + urlString);
                return null;
            }

            Scanner scanner =
                new Scanner(conn.getInputStream(), "UTF-8")
                    .useDelimiter("\\A");

            String body = scanner.hasNext()
                ? scanner.next()
                : "";

            scanner.close();

            return body;

        } catch (Exception e) {
            Log.e(TAG, "fetchWithToken error: " + e.getMessage(), e);
            return null;

        } finally {
            if (conn != null) conn.disconnect();
        }
    }


    public static void downloadPlugin(String token, String pluginUrl, String destFile, CallbackContext callbackContext) {
        HttpURLConnection connection = null;

        try {
            // Strip file:// prefix if present
            if (destFile.startsWith("file://")) {
                destFile = destFile.substring(7);
            }

            URL url = new URL(pluginUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);

            if (token != null && !token.isEmpty()) {
                String host = url.getHost();

                if (host != null &&
                    (host.equals("acode.app") || host.endsWith(".acode.app"))) {
                    connection.setRequestProperty("x-auth-token", token);
                }else {
                    Log.w(TAG, "Not adding auth token for untrusted URL: " + url);
                }
            }

            connection.connect();

            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                callbackContext.error("HTTP error: " + responseCode);
                return;
            }

            File tempFile = new File(destFile);

            try (
                InputStream inputStream = connection.getInputStream();
                FileOutputStream outputStream = new FileOutputStream(tempFile)
            ) {
                byte[] buffer = new byte[4096];
                int bytesRead;

                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, bytesRead);
                }
            }

            callbackContext.success();

        } catch (Exception e) {
            callbackContext.error("Download failed: " + e.getMessage());

        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }


    public static JSONArray fetchJsonArray(String urlString, String token) {
        HttpURLConnection conn = null;
        try {
            Log.d(TAG, "Fetching: " + urlString);
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            if (token != null && !token.isEmpty()) {
               String host = url.getHost();

                if (host != null &&
                    (host.equals("acode.app") || host.endsWith(".acode.app"))) {
                    conn.setRequestProperty("x-auth-token", token);
                }else {
                    Log.w(TAG, "Not adding auth token for untrusted URL: " + url);
                }
            }

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "Non-200 response (" + code + ") for: " + urlString);
                return null;
            }

            Scanner s = new Scanner(conn.getInputStream(), "UTF-8").useDelimiter("\\A");
            String body = s.hasNext() ? s.next() : "[]";
            s.close();
            return new JSONArray(body);
        } catch (Exception e) {
            Log.e(TAG, "fetchJsonArray error: " + e.getMessage(), e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

  
    
}