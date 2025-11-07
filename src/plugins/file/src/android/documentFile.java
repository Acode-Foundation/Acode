package com.foxdebug.acode.rk.file;

import org.apache.cordova.*;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import android.net.Uri;
import android.content.Context;
import android.util.Log;

import androidx.documentfile.provider.DocumentFile;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class documentFile extends CordovaPlugin {

    private Context getContext() {
        return cordova.getContext();
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        try {
            switch (action) {
                case "exists": return handleExists(args, callbackContext);
                case "isFile": return handleIsFile(args, callbackContext);
                case "isDirectory": return handleIsDirectory(args, callbackContext);
                case "getLength": return handleGetLength(args, callbackContext);
                case "getName": return handleGetName(args, callbackContext);
                case "getParentFile": return handleGetParentFile(args, callbackContext);
                case "listFiles": return handleListFiles(args, callbackContext);
                case "createNewFile": return handleCreateNewFile(args, callbackContext);
                case "mkdir": return handleMkdir(args, callbackContext);
                case "delete": return handleDelete(args, callbackContext);
                case "readText": return handleReadText(args, callbackContext);
                case "writeText": return handleWriteText(args, callbackContext);
                case "canRead": return handleCanRead(args, callbackContext);
                case "canWrite": return handleCanWrite(args, callbackContext);
                case "childByNameExists": return handleChildByNameExists(args, callbackContext);
                case "getChildByName": return handleGetChildByName(args, callbackContext);
                case "toUri": return handleToUri(args, callbackContext);
                default: return false;
            }
        } catch (Exception e) {
            callbackContext.error("Error: " + e.getMessage());
            return true;
        }
    }

    private DocumentFile fromUri(String uriStr) {
        Uri uri = Uri.parse(uriStr);
        return DocumentFile.fromTreeUri(getContext(), uri);
    }

    private boolean handleExists(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null && f.exists() ? 1 : 0);
        return true;
    }

    private boolean handleIsFile(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null && f.isFile() ? 1 : 0);
        return true;
    }

    private boolean handleIsDirectory(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null && f.isDirectory() ? 1 : 0);
        return true;
    }

    private boolean handleGetLength(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null ? (int) f.length() : 0);
        return true;
    }

    private boolean handleGetName(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null ? f.getName() : "");
        return true;
    }

    private boolean handleGetParentFile(JSONArray args, CallbackContext cb) throws JSONException {
        android.util.Log.d("DocumentFile.java",args.getString(0));
        DocumentFile f = fromUri(args.getString(0));
        DocumentFile parent = f != null ? f.getParentFile() : null;
        cb.success(parent != null ? parent.getUri().toString() : "");
        return true;
    }

    private boolean handleListFiles(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        if (f == null || !f.isDirectory()) {
            cb.error("Not a directory or invalid URI");
            return true;
        }

        JSONArray result = new JSONArray();
        for (DocumentFile file : f.listFiles()) {
            result.put(file.getUri().toString());
        }
        cb.success(result);
        return true;
    }

    private boolean handleCreateNewFile(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile parent = fromUri(args.getString(0));
        String mime = args.optString(1, "text/plain");
        String name = args.optString(2, "newfile.txt");

        if (parent != null && parent.isDirectory()) {
            DocumentFile newFile = parent.createFile(mime, name);
            cb.success(newFile != null ? newFile.getUri().toString() : "");
        } else {
            cb.error("Invalid parent directory");
        }
        return true;
    }

    private boolean handleMkdir(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile parent = fromUri(args.getString(0));
        String name = args.optString(1, "NewFolder");

        if (parent != null && parent.isDirectory()) {
            DocumentFile newDir = parent.createDirectory(name);
            cb.success(newDir != null ? 1 : 0);
        } else {
            cb.error("Invalid parent directory");
        }
        return true;
    }

    private boolean handleDelete(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null && f.delete() ? 1 : 0);
        return true;
    }

    private boolean handleReadText(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        String encoding = args.length() > 1 ? args.getString(1) : "UTF-8";

        try (InputStream in = getContext().getContentResolver().openInputStream(f.getUri())) {
            byte[] data = in.readAllBytes();
            cb.success(new String(data, encoding));
        } catch (Exception e) {
            cb.error(e.getMessage());
        }
        return true;
    }

    private boolean handleWriteText(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        String text = args.getString(1);
        String encoding = args.length() > 2 ? args.getString(2) : "UTF-8";

        try (OutputStream out = getContext().getContentResolver().openOutputStream(f.getUri(), "wt")) {
            out.write(text.getBytes(encoding));
            out.flush();
            cb.success(1);
        } catch (Exception e) {
            cb.error(e.getMessage());
        }
        return true;
    }

    private boolean handleCanRead(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null && f.canRead() ? 1 : 0);
        return true;
    }

    private boolean handleCanWrite(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null && f.canWrite() ? 1 : 0);
        return true;
    }

    private boolean handleChildByNameExists(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile parent = fromUri(args.getString(0));
        String childName = args.getString(1);
        if (parent == null || !parent.isDirectory()) {
            cb.success(0);
            return true;
        }
        DocumentFile child = parent.findFile(childName);
        cb.success(child != null && child.exists() ? 1 : 0);
        return true;
    }

    private boolean handleGetChildByName(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile parent = fromUri(args.getString(0));
        String childName = args.getString(1);
        if (parent == null || !parent.isDirectory()) {
            cb.success("");
            return true;
        }
        DocumentFile child = parent.findFile(childName);
        cb.success(child != null ? child.getUri().toString() : "");
        return true;
    }

    private boolean handleToUri(JSONArray args, CallbackContext cb) throws JSONException {
        DocumentFile f = fromUri(args.getString(0));
        cb.success(f != null ? f.getUri().toString() : "");
        return true;
    }
}
