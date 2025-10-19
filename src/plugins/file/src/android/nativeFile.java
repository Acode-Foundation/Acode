package com.foxdebug.acode.rk.file;

import org.apache.cordova.*;
import org.json.JSONArray;
import org.json.JSONException;

import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class nativeFile extends CordovaPlugin {

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        try {
            switch (action) {
                case "exists":
                    return handleExists(args, callbackContext);

                case "isFile":
                    return handleIsFile(args, callbackContext);

                case "isDirectory":
                    return handleIsDirectory(args, callbackContext);

                case "getLength":
                    return handleGetLength(args, callbackContext);

                case "getName":
                    return handleGetName(args, callbackContext);

                case "getParentFile":
                    return handleGetParentFile(args, callbackContext);

                case "listFiles":
                    return handleListFiles(args, callbackContext);

                case "createNewFile":
                    return handleCreateNewFile(args, callbackContext);

                case "mkdir":
                    return handleMkdir(args, callbackContext);

                case "mkdirs":
                    return handleMkdirs(args, callbackContext);

                case "delete":
                    return handleDelete(args, callbackContext);

                case "readText":
                    return handleReadText(args, callbackContext);

                case "writeText":
                    return handleWriteText(args, callbackContext);

                case "canRead":
                    return handleCanRead(args, callbackContext);

                case "canWrite":
                    return handleCanWrite(args, callbackContext);

                case "childByNameExists":
                    return handleChildByNameExists(args, callbackContext);

                case "getChildByName":
                    return handleGetChildByName(args, callbackContext);

                case "isLink":
                    return handleIsLink(args, callbackContext);

                case "toUri":
                    return handleToUri(args, callbackContext);

                default:
                    return false;
            }
        } catch (Exception e) {
            callbackContext.error("Error: " + e.getMessage());
            return true;
        }
    }

    private boolean handleExists(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.exists() ? 1 : 0);
        return true;
    }

    private boolean handleIsFile(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.isFile() ? 1 : 0);
        return true;
    }

    private boolean handleIsDirectory(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.isDirectory() ? 1 : 0);
        return true;
    }

    private boolean handleGetLength(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success((int) f.length());
        return true;
    }

    private boolean handleGetName(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.getName());
        return true;
    }

    private boolean handleGetParentFile(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        File parent = f.getParentFile();
        cb.success(parent != null ? parent.getAbsolutePath() : "");
        return true;
    }

    private boolean handleListFiles(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        if (!f.isDirectory()) {
            cb.error("Not a directory");
            return true;
        }
        File[] files = f.listFiles();
        JSONArray result = new JSONArray();
        if (files != null) {
            for (File file : files) {
                result.put(file.getAbsolutePath());
            }
        }
        cb.success(result);
        return true;
    }

    private boolean handleCreateNewFile(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        try {
            boolean created = f.createNewFile();
            cb.success(created ? 1 : 0);
        } catch (IOException e) {
            cb.error(e.getMessage());
        }
        return true;
    }

    private boolean handleMkdir(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.mkdir() ? 1 : 0);
        return true;
    }

    private boolean handleMkdirs(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.mkdirs() ? 1 : 0);
        return true;
    }

    private boolean handleDelete(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.delete() ? 1 : 0);
        return true;
    }

    private boolean handleReadText(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        String encoding = args.length() > 1 ? args.getString(1) : "UTF-8";
        try (FileInputStream fis = new FileInputStream(f)) {
            byte[] data = new byte[(int) f.length()];
            fis.read(data);
            String text = new String(data, encoding);
            cb.success(text);
        } catch (Exception e) {
            cb.error(e.getMessage());
        }
        return true;
    }

    private boolean handleWriteText(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        String text = args.getString(1);
        String encoding = args.length() > 2 ? args.getString(2) : "UTF-8";
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(text.getBytes(encoding));
            fos.flush();
            cb.success(1);
        } catch (Exception e) {
            cb.error(e.getMessage());
        }
        return true;
    }

    // New methods below

    private boolean handleCanRead(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.canRead() ? 1 : 0);
        return true;
    }

    private boolean handleCanWrite(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        cb.success(f.canWrite() ? 1 : 0);
        return true;
    }

    private boolean handleChildByNameExists(JSONArray args, CallbackContext cb) throws JSONException {
        File parent = new File(args.getString(0));
        String childName = args.getString(1);

        if (!parent.isDirectory()) {
            cb.success(0);
            return true;
        }

        File child = new File(parent, childName);
        cb.success(child.exists() ? 1 : 0);
        return true;
    }

    private boolean handleGetChildByName(JSONArray args, CallbackContext cb) throws JSONException {
        File parent = new File(args.getString(0));
        String childName = args.getString(1);

        if (!parent.isDirectory()) {
            cb.success("");
            return true;
        }

        File child = new File(parent, childName);
        if (child.exists()) {
            cb.success(child.getAbsolutePath());
        } else {
            cb.success("");
        }
        return true;
    }

    private boolean handleIsLink(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));

        // For API 26+, use Files.isSymbolicLink
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            try {
                Path path = Paths.get(f.getAbsolutePath());
                cb.success(Files.isSymbolicLink(path) ? 1 : 0);
            } catch (Exception e) {
                cb.success(0);
            }
        } else {
            // Fallback for older Android versions
            try {
                String canonicalPath = f.getCanonicalPath();
                String absolutePath = f.getAbsolutePath();
                boolean isLink = !canonicalPath.equals(absolutePath);
                cb.success(isLink ? 1 : 0);
            } catch (IOException e) {
                cb.success(0);
            }
        }
        return true;
    }

    private boolean handleToUri(JSONArray args, CallbackContext cb) throws JSONException {
        File f = new File(args.getString(0));
        try {
            String uri = f.toURI().toString();
            cb.success(uri);
        } catch (Exception e) {
            cb.error(e.getMessage());
        }
        return true;
    }
}