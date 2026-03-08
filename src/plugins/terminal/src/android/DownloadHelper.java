package com.foxdebug.acode.rk.exec.terminal;

import org.apache.cordova.*;
import org.json.*;

class DownloadHelper {

    static void download(String url, String dst, CallbackContext callbackContext) {
        java.net.HttpURLConnection conn = null;
        try {
            java.net.URI originalUri = java.net.URI.create(url);
            java.net.URI currentUri = originalUri;
            boolean originalHttps = "https".equalsIgnoreCase(originalUri.getScheme());
            int redirectCount = 0;
            final int maxRedirects = 5;
            int code;

            while (true) {
                if (conn != null) {
                    conn.disconnect();
                }

                java.net.URL u = currentUri.toURL();
                conn = (java.net.HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(60000);
                conn.connect();
                code = conn.getResponseCode();

                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    if (redirectCount >= maxRedirects) {
                        callbackContext.error("Too many redirects");
                        return;
                    }

                    String loc = conn.getHeaderField("Location");
                    if (loc == null || loc.isEmpty()) {
                        callbackContext.error("Redirect with no Location header (HTTP " + code + ")");
                        return;
                    }

                    java.net.URI redirectUri = java.net.URI.create(loc);
                    if (!redirectUri.isAbsolute()) {
                        redirectUri = currentUri.resolve(redirectUri);
                    }

                    String scheme = redirectUri.getScheme();
                    if (scheme == null ||
                        (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))) {
                        callbackContext.error("Unsupported redirect scheme: " + scheme);
                        return;
                    }

                    if (originalHttps && "http".equalsIgnoreCase(scheme)) {
                        callbackContext.error("Refusing to follow HTTPS to HTTP redirect");
                        return;
                    }

                    // GitHub release assets routinely redirect to signed CDN hosts, so
                    // same-host enforcement would break valid downloads. We only allow
                    // HTTP(S) targets and block HTTPS downgrade instead of pinning hosts.
                    currentUri = redirectUri;
                    redirectCount++;
                    continue;
                }

                break;
            }

            if (code != 200) {
                callbackContext.error("HTTP " + code);
                return;
            }

            long contentLength = conn.getContentLengthLong();
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
            callbackContext.success(dst);
        } catch (Exception e) {
            callbackContext.error("download failed: " + e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
}
