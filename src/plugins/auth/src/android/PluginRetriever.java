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
    private static final int LIMIT = 50;
    private static final String API_BASE = "https://acode.app/api";
    private static final String SUPPORTED_EDITOR = "cm";

    // Appends supported_editor param — mirrors JS withSupportedEditor()
    private static String withSupportedEditor(String url) {
        String separator = url.contains("?") ? "&" : "?";
        return url + separator + "supported_editor=" + SUPPORTED_EDITOR;
    }


    public static void getAllPlugins(String token, int page, CallbackContext callbackContext) {
        String url = withSupportedEditor(API_BASE + "/plugins?page=" + page + "&limit=" + LIMIT);
        JSONArray plugins = fetchJsonArray(url, token);

        try {
            JSONObject result = new JSONObject();
            if (plugins == null) plugins = new JSONArray();
            result.put("items", plugins);
            result.put("hasMore", plugins.length() == LIMIT);
            callbackContext.success(result);
        } catch (JSONException e) {
            Log.e(TAG, "getAllPlugins error: " + e.getMessage(), e);
            callbackContext.error("Failed to build result: " + e.getMessage());
        }
    }



    public static void retrieveFilteredPlugins(String token, JSONObject filterState, CallbackContext callbackContext) throws Exception {
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
                url = withSupportedEditor(API_BASE + "/plugins?explore=random&page=" + page + "&limit=" + LIMIT);
            } else {
                url = withSupportedEditor(API_BASE + "/plugin?orderBy=" + value + "&page=" + page + "&limit=" + LIMIT);
            }

            JSONArray items = fetchJsonArray(url, token);
            if (items == null) items = new JSONArray();

            filterState.put("nextPage", page + 1);
            result.put("items", items);
            result.put("hasMore", items.length() == LIMIT);
            result.put("filterState", filterState);
            callbackContext.success(result);
            return;
        }

        // --- Buffered filter path (verified, author, keywords) ---

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
                buffer = shiftBuffer(buffer);
                filterState.put("buffer", buffer);
                continue;
            }

            if (!hasMoreSource) break;

            String url = withSupportedEditor(API_BASE + "/plugins?page=" + nextPage + "&limit=" + LIMIT);
            JSONArray data = fetchJsonArray(url, token);
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
            buffer = shiftBuffer(buffer);
            filterState.put("buffer", buffer);
        }

        boolean hasMore = (hasMoreSource && filterState.has("nextPage")) || buffer.length() > 0;

        result.put("items", items);
        result.put("hasMore", hasMore);
        callbackContext.success(result);
    }

    // Removes first element from JSONArray (mirrors JS Array.shift())
    private static JSONArray shiftBuffer(JSONArray buffer) throws JSONException {
        JSONArray newBuffer = new JSONArray();
        for (int i = 1; i < buffer.length(); i++) {
            newBuffer.put(buffer.get(i));
        }
        return newBuffer;
    }

    private static JSONArray fetchJsonArray(String urlString, String token) {
        HttpURLConnection conn = null;
        try {
            Log.d(TAG, "Fetching: " + urlString);
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("x-auth-token", token);
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

    private static boolean matchesFilter(JSONObject plugin, JSONObject filterState) {
        try {
            String type = filterState.optString("type", "");

            switch (type) {
                case "verified":
                    // Mirrors JS: Boolean(plugin.author_verified)
                    return plugin.optBoolean("author_verified", false);

                case "author": {
                    String filterValue = filterState.optString("value", "").toLowerCase();
                    if (filterValue.isEmpty()) return true;
                    String authorName = normalizePluginAuthor(plugin).toLowerCase();
                    return authorName.contains(filterValue);
                }

                case "keywords": {
                    // value is a JSONArray of lowercase keyword strings
                    JSONArray filterKeywords = filterState.optJSONArray("value");
                    if (filterKeywords == null || filterKeywords.length() == 0) return true;

                    JSONArray pluginKeywords = normalizePluginKeywords(plugin);
                    if (pluginKeywords.length() == 0) return false;

                    // JS: filterState.value.some(keyword =>
                    //       pluginKeywords.some(pk => pk.includes(keyword)))
                    for (int fi = 0; fi < filterKeywords.length(); fi++) {
                        String fk = filterKeywords.getString(fi).toLowerCase();
                        for (int pi = 0; pi < pluginKeywords.length(); pi++) {
                            String pk = pluginKeywords.getString(pi).toLowerCase();
                            if (pk.contains(fk)) return true;
                        }
                    }
                    return false;
                }

                case "search": {
                    String value = filterState.optString("value", "").toLowerCase();
                    if (value.isEmpty()) return true;
                    String name = plugin.optString("name", "").toLowerCase();
                    String desc = plugin.optString("description", "").toLowerCase();
                    return name.contains(value) || desc.contains(value);
                }

                default:
                    return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "matchesFilter error: " + e.getMessage(), e);
            return false;
        }
    }

    // Mirrors JS normalizePluginAuthor() — author can be string or object
    private static String normalizePluginAuthor(JSONObject plugin) {
        try {
            Object author = plugin.opt("author");
            if (author == null) return "";
            if (author instanceof String) return (String) author;
            if (author instanceof JSONObject) {
                JSONObject authorObj = (JSONObject) author;
                String name = authorObj.optString("name", "");
                if (!name.isEmpty()) return name;
                String username = authorObj.optString("username", "");
                if (!username.isEmpty()) return username;
                return authorObj.optString("github", "");
            }
        } catch (Exception e) {
            Log.e(TAG, "normalizePluginAuthor error: " + e.getMessage(), e);
        }
        return "";
    }

    // Mirrors JS normalizePluginKeywords() — keywords can be array or comma string
    private static JSONArray normalizePluginKeywords(JSONObject plugin) {
        try {
            Object keywords = plugin.opt("keywords");
            if (keywords == null) return new JSONArray();
            if (keywords instanceof JSONArray) return (JSONArray) keywords;
            if (keywords instanceof String) {
                String kStr = (String) keywords;
                // Try parsing as JSON array first
                try {
                    return new JSONArray(kStr);
                } catch (JSONException e) {
                    // Fall back to comma-split
                    JSONArray result = new JSONArray();
                    for (String part : kStr.split(",")) {
                        String trimmed = part.trim();
                        if (!trimmed.isEmpty()) result.put(trimmed);
                    }
                    return result;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "normalizePluginKeywords error: " + e.getMessage(), e);
        }
        return new JSONArray();
    }
}