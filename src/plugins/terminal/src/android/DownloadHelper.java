package com.foxdebug.acode.rk.exec.terminal;

import org.apache.cordova.*;
import org.json.*;

class DownloadHelper {

    static void download(String url, String dst, CallbackContext callbackContext) {
        try {
            java.net.URL u = java.net.URI.create(url).toURL();
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(60000);
            conn.connect();
            int code = conn.getResponseCode();
            // Follow redirects across protocols (HTTP→HTTPS)
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                u = java.net.URI.create(loc).toURL();
                conn = (java.net.HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(60000);
                conn.connect();
                code = conn.getResponseCode();
            }
            if (code != 200) {
                conn.disconnect();
                callbackContext.error("HTTP " + code);
                return;
            }
            long contentLength = conn.getContentLength();
            java.io.File dstFile = new java.io.File(dst);
            byte[] buf = new byte[65536];
            long downloaded = 0;
            long startTime = System.currentTimeMillis();
            long lastReportTime = 0;
            try (java.io.InputStream is = conn.getInputStream();
                 java.io.FileOutputStream fos = new java.io.FileOutputStream(dstFile)) {
                int len;
                while ((len = is.read(buf)) > 0) {
                    fos.write(buf, 0, len);
                    downloaded += len;
                    long now = System.currentTimeMillis();
                    if (now - lastReportTime >= 500) {
                        lastReportTime = now;
                        long elapsed = now - startTime;
                        long speed = elapsed > 0 ? downloaded * 1000 / elapsed : 0;
                        long eta = (speed > 0 && contentLength > 0) ? (contentLength - downloaded) / speed : -1;
                        JSONObject progress = new JSONObject();
                        progress.put("type", "progress");
                        progress.put("downloaded", downloaded);
                        progress.put("total", contentLength);
                        progress.put("speed", speed);
                        progress.put("eta", eta);
                        PluginResult pr = new PluginResult(PluginResult.Status.OK, progress.toString());
                        pr.setKeepCallback(true);
                        callbackContext.sendPluginResult(pr);
                    }
                }
            }
            conn.disconnect();
            callbackContext.success(dst);
        } catch (Exception e) {
            callbackContext.error("download failed: " + e.getMessage());
        }
    }
}
