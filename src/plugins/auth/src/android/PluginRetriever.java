package com.foxdebug.acode.rk.auth;

import android.util.Log;
import org.apache.cordova.CallbackContext;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;

public class PluginRetriever {
    private static final String TAG = "AcodePluginRetriever";
    private static final int LIMIT = 20;
    private static final String API_BASE = "https://acode.app/api";

    public static void retrieveFilteredPlugins(String token,JSONObject filterState, CallbackContext callbackContext) throws Exception {
        JSONObject result = new JSONObject();

        if (filterState == null) {
            result.put("items", new JSONArray());
            result.put("hasMore", false);
            callbackContext.success(result);
            return;
        }

        String type = filterState.optString("type", "");

        if ("orderBy".equals(type)) {
            int page = filterState.optInt("nextPage", 1);
            String value = filterState.optString("value", "");
            String url;

            if ("top_rated".equals(value)) {
                url = API_BASE + "/plugins?explore=random&page=" + page + "&limit=" + LIMIT;
            } else {
                url = API_BASE + "/plugin?orderBy=" + value + "&page=" + page + "&limit=" + LIMIT;
            }

            JSONArray items = fetchJsonArray(url,token);
            if (items == null) items = new JSONArray();

            filterState.put("nextPage", page + 1);
            result.put("items", items);
            result.put("hasMore", items.length() == LIMIT);
            callbackContext.success(result);
            return;
        }

        JSONArray buffer = filterState.optJSONArray("buffer");
        if (buffer == null) {
            buffer = new JSONArray();
            filterState.put("buffer", buffer);
        }

        boolean hasMoreSource = !filterState.has("hasMoreSource") || filterState.getBoolean("hasMoreSource");
        int nextPage = filterState.optInt("nextPage", 1);
        if (!filterState.has("nextPage")) {
            filterState.put("nextPage", 1);
        }

        JSONArray items = new JSONArray();

        while (items.length() < LIMIT) {
            if (buffer.length() > 0) {
                items.put(buffer.get(0));
                JSONArray newBuffer = new JSONArray();
                for (int i = 1; i < buffer.length(); i++) newBuffer.put(buffer.get(i));
                buffer = newBuffer;
                filterState.put("buffer", buffer);
                continue;
            }

            if (!hasMoreSource) break;

            String url = API_BASE + "/plugins?page=" + nextPage + "&limit=" + LIMIT;
            JSONArray data = fetchJsonArray(url,token);
            nextPage++;
            filterState.put("nextPage", nextPage);

            if (data == null || data.length() == 0) {
                hasMoreSource = false;
                filterState.put("hasMoreSource", false);
                break;
            }

            if (data.length() < LIMIT) {
                hasMoreSource = false;
                filterState.put("hasMoreSource", false);
            }

            for (int i = 0; i < data.length(); i++) {
                JSONObject plugin = data.getJSONObject(i);
                if (matchesFilter(plugin, filterState)) {
                    buffer.put(plugin);
                }
            }
            filterState.put("buffer", buffer);
        }

        while (items.length() < LIMIT && buffer.length() > 0) {
            items.put(buffer.get(0));
            JSONArray newBuffer = new JSONArray();
            for (int i = 1; i < buffer.length(); i++) newBuffer.put(buffer.get(i));
            buffer = newBuffer;
            filterState.put("buffer", buffer);
        }

        boolean hasMore = (hasMoreSource && filterState.has("nextPage")) || buffer.length() > 0;

        result.put("items", items);
        result.put("hasMore", hasMore);
        callbackContext.success(result);
    }

    // Change fetchJsonArray signature to accept token
    private static JSONArray fetchJsonArray(String urlString, String token) {
        HttpURLConnection conn = null;
        try {
            Log.d(TAG, "Fetching: " + urlString);
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            
            // Add auth header if token is present
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "Non-200 response (" + code + ") for: " + urlString);
                return null;
            }

            Scanner s = new Scanner(conn.getInputStream(), "UTF-8").useDelimiter("\\A");
            String body = s.hasNext() ? s.next() : "[]";
            return new JSONArray(body);
        } catch (Exception e) {
            Log.e(TAG, "fetchJsonArray error: " + e.getMessage(), e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static boolean matchesFilter(JSONObject plugin, JSONObject filterState) {
        try {
            String type = filterState.optString("type", "");
            String value = filterState.optString("value", "").toLowerCase();

            if (value.isEmpty()) return true;

            switch (type) {
                case "search":
                    String name = plugin.optString("name", "").toLowerCase();
                    String desc = plugin.optString("description", "").toLowerCase();
                    return name.contains(value) || desc.contains(value);
                case "author":
                    String author = plugin.optString("author", "").toLowerCase();
                    return author.contains(value);
                default:
                    return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "matchesFilter error: " + e.getMessage(), e);
            return false;
        }
    }
}