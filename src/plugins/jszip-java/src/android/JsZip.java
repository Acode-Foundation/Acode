package com.foxdebug.acode.rk.zip;

import android.util.Base64;
import android.util.Log;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.apache.cordova.*;
import org.json.*;

public class JsZip extends CordovaPlugin {
    
    private final ConcurrentHashMap<String, ZipInstance> instances = new ConcurrentHashMap<>();

    private static class FileEntry {
        String name;
        boolean isDir;
        long date;
        String comment;
        Integer unixPermissions;
        Integer dosPermissions;
        File tempFile;
    }

    private static class ZipInstance {
        String id;
        File baseDir;
        ConcurrentHashMap<String, FileEntry> entries = new ConcurrentHashMap<>();

        ZipInstance(String id, File cacheDir) {
            this.id = id;
            this.baseDir = new File(cacheDir, "jszip_" + id);
            if (!baseDir.exists()) {
                baseDir.mkdirs();
            }
        }

        void destroy() {
            deleteDir(baseDir);
        }
    }

    private static void deleteDir(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteDir(child);
                }
            }
        }
        file.delete();
    }

    private static Method setExternalAttributesMethod = null;
    private static Method getExternalAttributesMethod = null;
    static {
        try {
            setExternalAttributesMethod = ZipEntry.class.getMethod("setExternalAttributes", long.class);
        } catch (Exception e) {
            // Not available
        }
        try {
            getExternalAttributesMethod = ZipEntry.class.getMethod("getExternalAttributes");
        } catch (Exception e) {
            // Not available
        }
    }

    private static void setUnixPermissions(ZipEntry ze, FileEntry entry) {
        if (setExternalAttributesMethod != null) {
            try {
                long attrs = 0;
                if (entry.unixPermissions != null) {
                    attrs = ((long) entry.unixPermissions) << 16;
                } else if (entry.dosPermissions != null) {
                    attrs = entry.dosPermissions & 0xFF;
                } else {
                    attrs = (entry.isDir ? 0755 : 0644) << 16;
                }
                if (entry.isDir) {
                    attrs |= 0x10;
                }
                setExternalAttributesMethod.invoke(ze, attrs);
            } catch (Exception e) {
                // Ignore
            }
        }
    }

    private static Integer getUnixPermissions(ZipEntry ze) {
        if (getExternalAttributesMethod != null) {
            try {
                long attrs = (Long) getExternalAttributesMethod.invoke(ze);
                if (attrs != 0) {
                    return (int) ((attrs >> 16) & 0xFFFF);
                }
            } catch (Exception e) {
                // Ignore
            }
        }
        return null;
    }

    @Override
    protected void pluginInitialize() {
        super.pluginInitialize();
        cordova.getThreadPool().execute(new Runnable() {
            @Override
            public void run() {
                File cacheDir = cordova.getActivity().getCacheDir();
                File[] children = cacheDir.listFiles();
                if (children != null) {
                    for (File child : children) {
                        if (child.getName().startsWith("jszip_")) {
                            deleteDir(child);
                        }
                    }
                }
            }
        });
    }

    @Override
    public void onDestroy() {
        cordova.getThreadPool().execute(new Runnable() {
            @Override
            public void run() {
                for (String id : instances.keySet()) {
                    destroyInstance(id, null);
                }
            }
        });
        super.onDestroy();
    }

    @Override
    public boolean execute(
        String action,
        CordovaArgs args,
        final CallbackContext callbackContext
    ) throws JSONException {
        cordova.getThreadPool().execute(
            new Runnable() {
                @Override
                public void run() {
                    try {
                        if ("create".equals(action)) {
                            String id = args.getString(0);
                            createInstance(id);
                            callbackContext.success();
                        } else if ("addFile".equals(action)) {
                            String id = args.getString(0);
                            String path = args.getString(1);
                            JSONObject options = args.optJSONObject(3);
                            if (options == null) {
                                options = new JSONObject();
                            }
                            addFile(id, path, args, options, callbackContext);
                        } else if ("removeFile".equals(action)) {
                            String id = args.getString(0);
                            String path = args.getString(1);
                            removeFile(id, path, callbackContext);
                        } else if ("load".equals(action)) {
                            String id = args.getString(0);
                            JSONObject options = args.optJSONObject(2);
                            if (options == null) {
                                options = new JSONObject();
                            }
                            loadZip(id, args, options, callbackContext);
                        } else if ("getFileContent".equals(action)) {
                            String id = args.getString(0);
                            String path = args.getString(1);
                            String type = args.getString(2);
                            getFileContent(id, path, type, callbackContext);
                        } else if ("generate".equals(action)) {
                            String id = args.getString(0);
                            String prefix = args.getString(1);
                            JSONObject options = args.optJSONObject(2);
                            if (options == null) {
                                options = new JSONObject();
                            }
                            generateZip(id, prefix, options, callbackContext);
                        } else if ("destroy".equals(action)) {
                            String id = args.getString(0);
                            destroyInstance(id, callbackContext);
                        } else if ("extractToDir".equals(action)) {
                            String id = args.getString(0);
                            String prefix = args.getString(1);
                            String targetDir = args.getString(2);
                            extractToDir(id, prefix, targetDir, callbackContext);
                        } else if ("extractZipFileToDir".equals(action)) {
                            String zipFilePath = args.getString(0);
                            String targetDir = args.getString(1);
                            extractZipFileToDir(zipFilePath, targetDir, callbackContext);
                        } else {
                            callbackContext.error("Invalid action: " + action);
                        }
                    } catch (Exception e) {
                        callbackContext.error("Error in action " + action + ": " + e.getMessage());
                    }
                }
            }
        );
        return true;
    }

    private void createInstance(String id) {
        File cacheDir = cordova.getActivity().getCacheDir();
        ZipInstance instance = new ZipInstance(id, cacheDir);
        instances.put(id, instance);
    }

    private void addFile(String id, String name, CordovaArgs args, JSONObject options, CallbackContext callbackContext) {
        try {
            ZipInstance instance = instances.get(id);
            if (instance == null) {
                callbackContext.error("Instance not found");
                return;
            }

            boolean isDir = options.optBoolean("dir", false);
            FileEntry entry = instance.entries.get(name);
            if (entry == null) {
                entry = new FileEntry();
                entry.name = name;
                instance.entries.put(name, entry);
            }

            entry.isDir = isDir;
            entry.comment = options.optString("comment", "");
            entry.date = options.optLong("date", System.currentTimeMillis());
            if (!options.isNull("unixPermissions")) {
                entry.unixPermissions = options.optInt("unixPermissions");
            }
            if (!options.isNull("dosPermissions")) {
                entry.dosPermissions = options.optInt("dosPermissions");
            }

            if (!isDir && !args.isNull(2)) {
                if (entry.tempFile == null) {
                    entry.tempFile = new File(instance.baseDir, UUID.randomUUID().toString() + ".tmp");
                }
                
                String dataType = options.optString("dataType", "string");
                byte[] bytes;
                if ("arraybuffer".equals(dataType)) {
                    bytes = args.getArrayBuffer(2);
                } else if ("base64".equals(dataType)) {
                    String data = args.getString(2);
                    bytes = Base64.decode(data, Base64.DEFAULT);
                } else {
                    String data = args.getString(2);
                    boolean binary = options.optBoolean("binary", false);
                    if (binary) {
                        bytes = data.getBytes("ISO-8859-1");
                    } else {
                        bytes = data.getBytes("UTF-8");
                    }
                }

                try (FileOutputStream fos = new FileOutputStream(entry.tempFile)) {
                    fos.write(bytes);
                }
            }

            callbackContext.success();
        } catch (Exception e) {
            callbackContext.error("Failed to add file: " + e.getMessage());
        }
    }

    private void removeFile(String id, String name, CallbackContext callbackContext) {
        try {
            ZipInstance instance = instances.get(id);
            if (instance == null) {
                callbackContext.error("Instance not found");
                return;
            }

            String normalizedDir = name.endsWith("/") ? name : name + "/";
            for (String key : instance.entries.keySet()) {
                if (key.equals(name) || key.equals(normalizedDir) || key.startsWith(normalizedDir)) {
                    FileEntry entry = instance.entries.remove(key);
                    if (entry != null && entry.tempFile != null && entry.tempFile.exists()) {
                        entry.tempFile.delete();
                    }
                }
            }
            callbackContext.success();
        } catch (Exception e) {
            callbackContext.error("Failed to remove file: " + e.getMessage());
        }
    }

    private void loadZip(String id, CordovaArgs args, JSONObject options, CallbackContext callbackContext) {
        File tempZipFile = null;
        try {
            ZipInstance instance = instances.get(id);
            if (instance == null) {
                callbackContext.error("Instance not found");
                return;
            }

            // Clean current entries if any
            for (FileEntry entry : instance.entries.values()) {
                if (entry.tempFile != null && entry.tempFile.exists()) {
                    entry.tempFile.delete();
                }
            }
            instance.entries.clear();

            String dataType = options.optString("dataType", "base64");
            byte[] zipBytes;
            if ("arraybuffer".equals(dataType)) {
                zipBytes = args.getArrayBuffer(1);
            } else if ("base64".equals(dataType)) {
                String data = args.getString(1);
                zipBytes = Base64.decode(data, Base64.DEFAULT);
            } else {
                String data = args.getString(1);
                zipBytes = data.getBytes("ISO-8859-1");
            }
            
            Log.d("JsZip", "loadZip: dataType=" + dataType + ", zipBytesLength=" + zipBytes.length);
            System.out.println("[JsZip-Java Debug Native] loadZip: dataType=" + dataType + ", zipBytesLength=" + zipBytes.length);
            
            // Write to a temporary ZIP file in cache
            tempZipFile = new File(instance.baseDir, "temp_load_" + UUID.randomUUID().toString() + ".zip");
            try (FileOutputStream fos = new FileOutputStream(tempZipFile)) {
                fos.write(zipBytes);
            }

            boolean createFolders = options.optBoolean("createFolders", false);
            JSONArray metaList = new JSONArray();

            // Open using ZipFile (robust against streaming Data Descriptors)
            try (java.util.zip.ZipFile zf = new java.util.zip.ZipFile(tempZipFile)) {
                java.util.Enumeration<? extends ZipEntry> entries = zf.entries();
                
                while (entries.hasMoreElements()) {
                    ZipEntry ze = entries.nextElement();
                    String name = ze.getName();
                    boolean isDir = ze.isDirectory();
                    
                    System.out.println("[JsZip-Java Debug Native] Found entry: " + name + ", isDir: " + isDir + ", compressedSize: " + ze.getCompressedSize());
                    
                    FileEntry entry = new FileEntry();
                    entry.name = name;
                    entry.isDir = isDir;
                    entry.date = ze.getTime();
                    entry.comment = ze.getComment();
                    entry.unixPermissions = getUnixPermissions(ze);
                    if (entry.unixPermissions == null) {
                        entry.unixPermissions = isDir ? 0755 : 0644;
                    }

                    if (!isDir) {
                        entry.tempFile = new File(instance.baseDir, UUID.randomUUID().toString() + ".tmp");
                        try (java.io.InputStream is = zf.getInputStream(ze);
                             FileOutputStream fos = new FileOutputStream(entry.tempFile)) {
                            byte[] buffer = new byte[8192];
                            int count;
                            while ((count = is.read(buffer)) != -1) {
                                fos.write(buffer, 0, count);
                            }
                        }
                    }

                    instance.entries.put(name, entry);

                    JSONObject meta = new JSONObject();
                    meta.put("name", name);
                    meta.put("dir", isDir);
                    meta.put("date", entry.date);
                    meta.put("comment", entry.comment != null ? entry.comment : "");
                    meta.put("unixPermissions", entry.unixPermissions);
                    meta.put("dosPermissions", entry.dosPermissions != null ? entry.dosPermissions : JSONObject.NULL);
                    metaList.put(meta);
                }
            }

            if (createFolders) {
                java.util.HashSet<String> impliedDirs = new java.util.HashSet<>();
                for (String name : instance.entries.keySet()) {
                    String[] parts = name.split("/");
                    String current = "";
                    for (int i = 0; i < parts.length - 1; i++) {
                        current += parts[i] + "/";
                        if (!instance.entries.containsKey(current)) {
                            impliedDirs.add(current);
                        }
                    }
                }
                for (String dirPath : impliedDirs) {
                    FileEntry folderEntry = new FileEntry();
                    folderEntry.name = dirPath;
                    folderEntry.isDir = true;
                    folderEntry.date = System.currentTimeMillis();
                    folderEntry.unixPermissions = 0755;
                    instance.entries.put(dirPath, folderEntry);

                    JSONObject meta = new JSONObject();
                    meta.put("name", dirPath);
                    meta.put("dir", true);
                    meta.put("date", folderEntry.date);
                    meta.put("comment", "");
                    meta.put("unixPermissions", 0755);
                    meta.put("dosPermissions", JSONObject.NULL);
                    metaList.put(meta);
                }
            }

            JSONObject resultObj = new JSONObject();
            resultObj.put("files", metaList);
            resultObj.put("base64Length", zipBytes.length); // Maintain compatibility/logs
            resultObj.put("zipBytesLength", zipBytes.length);
            callbackContext.success(resultObj);
        } catch (Exception e) {
            callbackContext.error("Failed to load ZIP: " + e.getMessage());
        } finally {
            if (tempZipFile != null && tempZipFile.exists()) {
                tempZipFile.delete();
            }
        }
    }

    private void getFileContent(String id, String name, String type, CallbackContext callbackContext) {
        try {
            ZipInstance instance = instances.get(id);
            if (instance == null) {
                callbackContext.error("Instance not found");
                return;
            }

            FileEntry entry = instance.entries.get(name);
            if (entry == null) {
                callbackContext.error("File not found: " + name);
                return;
            }

            if (entry.isDir) {
                callbackContext.error("Cannot get content of a directory");
                return;
            }

            if (entry.tempFile == null || !entry.tempFile.exists()) {
                callbackContext.error("Temporary file not found for entry: " + name);
                return;
            }

            byte[] bytes = new byte[(int) entry.tempFile.length()];
            try (FileInputStream fis = new FileInputStream(entry.tempFile)) {
                int offset = 0;
                int numRead = 0;
                while (offset < bytes.length && (numRead = fis.read(bytes, offset, bytes.length - offset)) >= 0) {
                    offset += numRead;
                }
            }

            // Return byte[] directly as raw binary
            PluginResult result = new PluginResult(PluginResult.Status.OK, bytes);
            callbackContext.sendPluginResult(result);
        } catch (Exception e) {
            callbackContext.error("Failed to get file content: " + e.getMessage());
        }
    }

    private void generateZip(String id, String prefix, JSONObject options, CallbackContext callbackContext) {
        try {
            ZipInstance instance = instances.get(id);
            if (instance == null) {
                callbackContext.error("Instance not found");
                return;
            }

            String compression = options.optString("compression", "STORE");
            int compressionLevel = options.optInt("compressionLevel", 6);
            String comment = options.optString("comment", null);

            File zipFile = new File(instance.baseDir, "output_" + UUID.randomUUID().toString() + ".zip");
            
            try (FileOutputStream fos = new FileOutputStream(zipFile);
                 ZipOutputStream zos = new ZipOutputStream(fos)) {

                if ("DEFLATE".equalsIgnoreCase(compression)) {
                    zos.setMethod(ZipOutputStream.DEFLATED);
                    zos.setLevel(compressionLevel);
                } else {
                    zos.setMethod(ZipOutputStream.STORED);
                }

                if (comment != null && !comment.isEmpty()) {
                    zos.setComment(comment);
                }

                List<String> sortedKeys = new ArrayList<>(instance.entries.keySet());
                Collections.sort(sortedKeys);

                int totalEntries = 0;
                for (String key : sortedKeys) {
                    if (key.startsWith(prefix)) {
                        totalEntries++;
                    }
                }

                int currentEntryIndex = 0;
                for (String key : sortedKeys) {
                    if (!key.startsWith(prefix)) {
                        continue;
                    }

                    FileEntry entry = instance.entries.get(key);
                    if (entry == null) {
                        continue;
                    }

                    String zipPath = key.substring(prefix.length());
                    if (zipPath.isEmpty()) {
                        continue;
                    }

                    currentEntryIndex++;

                    // Send progress update
                    JSONObject progress = new JSONObject();
                    progress.put("progress", true);
                    progress.put("percent", (currentEntryIndex * 100) / totalEntries);
                    progress.put("currentFile", zipPath);
                    PluginResult progressResult = new PluginResult(PluginResult.Status.OK, progress);
                    progressResult.setKeepCallback(true);
                    callbackContext.sendPluginResult(progressResult);

                    ZipEntry ze = new ZipEntry(zipPath);
                    ze.setTime(entry.date);
                    if (entry.comment != null && !entry.comment.isEmpty()) {
                        ze.setComment(entry.comment);
                    }
                    setUnixPermissions(ze, entry);

                    if (entry.isDir) {
                        if (!zipPath.endsWith("/")) {
                            ze = new ZipEntry(zipPath + "/");
                            setUnixPermissions(ze, entry);
                        }
                        if (!"DEFLATE".equalsIgnoreCase(compression)) {
                            ze.setSize(0);
                            ze.setCompressedSize(0);
                            ze.setCrc(0);
                        }
                        zos.putNextEntry(ze);
                        zos.closeEntry();
                    } else {
                        if (entry.tempFile != null && entry.tempFile.exists()) {
                            long size = entry.tempFile.length();
                            if (!"DEFLATE".equalsIgnoreCase(compression)) {
                                ze.setSize(size);
                                ze.setCompressedSize(size);
                                long crc = calculateCRC32(entry.tempFile);
                                ze.setCrc(crc);
                            }
                            
                            zos.putNextEntry(ze);
                            
                            try (FileInputStream fis = new FileInputStream(entry.tempFile)) {
                                byte[] buffer = new byte[8192];
                                int count;
                                while ((count = fis.read(buffer)) != -1) {
                                    zos.write(buffer, 0, count);
                                }
                            }
                            zos.closeEntry();
                        }
                    }
                }
                
                zos.finish();
            }

            byte[] zipBytes = new byte[(int) zipFile.length()];
            try (FileInputStream fis = new FileInputStream(zipFile)) {
                int offset = 0;
                int numRead = 0;
                while (offset < zipBytes.length && (numRead = fis.read(zipBytes, offset, zipBytes.length - offset)) >= 0) {
                    offset += numRead;
                }
            }

            zipFile.delete();

            // Return byte[] directly as raw binary
            PluginResult result = new PluginResult(PluginResult.Status.OK, zipBytes);
            callbackContext.sendPluginResult(result);
        } catch (Exception e) {
            callbackContext.error("Failed to generate ZIP: " + e.getMessage());
        }
    }

    private static long calculateCRC32(File file) throws IOException {
        CRC32 crc = new CRC32();
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = fis.read(buffer)) != -1) {
                crc.update(buffer, 0, count);
            }
        }
        return crc.getValue();
    }

    private static boolean isSafePath(File destDir, File destFile) throws IOException {
        String destDirCanonical = destDir.getCanonicalPath();
        String destFileCanonical = destFile.getCanonicalPath();
        return destFileCanonical.startsWith(destDirCanonical + File.separator) || destFileCanonical.equals(destDirCanonical);
    }

    private void extractToDir(String id, String prefix, String targetDir, CallbackContext callbackContext) {
        try {
            ZipInstance instance = instances.get(id);
            if (instance == null) {
                callbackContext.error("Instance not found");
                return;
            }

            File destDir = new File(targetDir);
            if (!destDir.exists()) {
                destDir.mkdirs();
            }

            List<String> sortedKeys = new ArrayList<>(instance.entries.keySet());
            Collections.sort(sortedKeys);

            int totalEntries = 0;
            for (String key : sortedKeys) {
                if (key.startsWith(prefix)) {
                    totalEntries++;
                }
            }

            int currentEntryIndex = 0;
            for (String key : sortedKeys) {
                if (!key.startsWith(prefix)) {
                    continue;
                }

                FileEntry entry = instance.entries.get(key);
                if (entry == null) {
                    continue;
                }

                String relativePath = key.substring(prefix.length());
                if (relativePath.isEmpty()) {
                    continue;
                }

                currentEntryIndex++;

                // Progress report
                JSONObject progress = new JSONObject();
                progress.put("progress", true);
                progress.put("percent", (currentEntryIndex * 100) / totalEntries);
                progress.put("currentFile", relativePath);
                PluginResult progressResult = new PluginResult(PluginResult.Status.OK, progress);
                progressResult.setKeepCallback(true);
                callbackContext.sendPluginResult(progressResult);

                File destFile = new File(destDir, relativePath);
                if (!isSafePath(destDir, destFile)) {
                    throw new SecurityException("Path traversal attempt detected in entry: " + relativePath);
                }

                if (entry.isDir) {
                    destFile.mkdirs();
                } else {
                    File parent = destFile.getParentFile();
                    if (parent != null && !parent.exists()) {
                        parent.mkdirs();
                    }

                    if (entry.tempFile != null && entry.tempFile.exists()) {
                        try (FileInputStream fis = new FileInputStream(entry.tempFile);
                             FileOutputStream fos = new FileOutputStream(destFile)) {
                            byte[] buffer = new byte[8192];
                            int count;
                            while ((count = fis.read(buffer)) != -1) {
                                fos.write(buffer, 0, count);
                            }
                        }
                    }
                }
            }

            callbackContext.success();
        } catch (Exception e) {
            callbackContext.error("Failed to extract: " + e.getMessage());
        }
    }

    private void extractZipFileToDir(String zipFilePath, String targetDir, CallbackContext callbackContext) {
        try {
            File zipFile = new File(zipFilePath);
            if (!zipFile.exists()) {
                callbackContext.error("Source zip file not found: " + zipFilePath);
                return;
            }

            File destDir = new File(targetDir);
            if (!destDir.exists()) {
                destDir.mkdirs();
            }

            try (java.util.zip.ZipFile zf = new java.util.zip.ZipFile(zipFile)) {
                int totalEntries = zf.size();
                int currentEntryIndex = 0;
                java.util.Enumeration<? extends ZipEntry> entries = zf.entries();

                while (entries.hasMoreElements()) {
                    ZipEntry ze = entries.nextElement();
                    String name = ze.getName();
                    boolean isDir = ze.isDirectory();
                    
                    currentEntryIndex++;

                    // Progress report
                    JSONObject progress = new JSONObject();
                    progress.put("progress", true);
                    progress.put("percent", (currentEntryIndex * 100) / totalEntries);
                    progress.put("currentFile", name);
                    PluginResult progressResult = new PluginResult(PluginResult.Status.OK, progress);
                    progressResult.setKeepCallback(true);
                    callbackContext.sendPluginResult(progressResult);

                    File destFile = new File(destDir, name);
                    if (!isSafePath(destDir, destFile)) {
                        throw new SecurityException("Path traversal attempt detected in entry: " + name);
                    }

                    if (isDir) {
                        destFile.mkdirs();
                    } else {
                        File parent = destFile.getParentFile();
                        if (parent != null && !parent.exists()) {
                            parent.mkdirs();
                        }

                        try (java.io.InputStream is = zf.getInputStream(ze);
                             FileOutputStream fos = new FileOutputStream(destFile)) {
                            byte[] buffer = new byte[8192];
                            int count;
                            while ((count = is.read(buffer)) != -1) {
                                fos.write(buffer, 0, count);
                            }
                        }
                    }
                }
            }

            callbackContext.success();
        } catch (Exception e) {
            callbackContext.error("Failed to extract ZIP: " + e.getMessage());
        }
    }

    private void destroyInstance(String id, CallbackContext callbackContext) {
        try {
            ZipInstance instance = instances.remove(id);
            if (instance != null) {
                instance.destroy();
            }
            if (callbackContext != null) {
                callbackContext.success();
            }
        } catch (Exception e) {
            if (callbackContext != null) {
                callbackContext.error("Failed to destroy: " + e.getMessage());
            }
        }
    }
}
