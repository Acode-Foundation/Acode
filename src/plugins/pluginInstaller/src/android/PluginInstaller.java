package com.foxdebug.acode.rk.plugininstaller;

import android.net.Uri;
import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Native helper for the Acode plugin installer.
 *
 * The JS installer (src/lib/installPlugin.js) used to unzip plugin archives
 * entry-by-entry on the JS thread, in hardcoded batches of 2 files with a
 * `setTimeout(0)` in between, purely so the WebView UI thread wouldn't
 * freeze while writing a lot of small files. That batch size was arbitrary
 * and made installing plugins with many files unnecessarily slow.
 *
 * This plugin moves the actual unzip + disk I/O to native code that runs on
 * Cordova's background thread pool (see CordovaInterface#getThreadPool()),
 * completely off the WebView/UI thread - so there is no UI thread to
 * babysit and no artificial batch-size limit is needed.
 *
 * The JS side stages the downloaded archive as a plain file under
 * CACHE_STORAGE and passes its path here, rather than base64-encoding the
 * whole zip through the JS bridge. That avoids inflating the payload by
 * ~33% and holding multiple full copies of it in memory (JS ArrayBuffer +
 * base64 string + bridge JSON + decoded Java byte[]) - {@link ZipFile}
 * reads straight off disk instead.
 *
 * Because extraction runs as a single native call for the whole archive,
 * cancellation is exposed as a separate "cancelExtract" action keyed by a
 * `requestId` the JS side generates: it flips a shared {@link AtomicBoolean}
 * that the extraction loop checks between (and, for large files, during)
 * entries, so a cancelled install stops promptly instead of running to
 * completion in the background after the user has given up on it.
 */
public class PluginInstaller extends CordovaPlugin {

    private static final String TAG = "PluginInstaller";
    private static final int BUFFER_SIZE = 8192;
    private static final String PLUGIN_MANIFEST = "plugin.json";

    /** Guards against zip bombs: reject any single entry larger than this once decompressed. */
    private static final long MAX_ENTRY_SIZE = 100L * 1024 * 1024; // 100 MB
    /** Guards against zip bombs: abort the whole extraction past this total decompressed size. */
    private static final long MAX_TOTAL_UNCOMPRESSED_SIZE = 500L * 1024 * 1024; // 500 MB
    /** How often (in entries) to report extraction progress back to JS. */
    private static final int PROGRESS_STEP = 10;

    /** requestId -> cancellation flag, for jobs currently in flight. */
    private final Map<String, AtomicBoolean> activeJobs = new ConcurrentHashMap<>();

    /** Thrown internally to unwind extraction as soon as a cancellation is observed. */
    private static class CancelledException extends RuntimeException {
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callback)
            throws JSONException {
        if ("extractZip".equals(action)) {
            final String requestId = args.getString(0);
            final String zipPath = args.getString(1);
            final String destDirUri = args.getString(2);
            final String pluginJsonOverride = args.isNull(3) ? null : args.getString(3);
            final JSONObject existingState = args.isNull(4) ? new JSONObject() : args.getJSONObject(4);

            final AtomicBoolean cancelled = new AtomicBoolean(false);
            activeJobs.put(requestId, cancelled);

            // Run entirely off the UI thread - no need to chunk work into
            // small batches just to keep the WebView responsive.
            cordova.getThreadPool().execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        extractZip(zipPath, destDirUri, pluginJsonOverride, existingState, cancelled, callback);
                    } finally {
                        activeJobs.remove(requestId);
                    }
                }
            });
            return true;
        }

        if ("cancelExtract".equals(action)) {
            final String requestId = args.getString(0);
            AtomicBoolean cancelled = activeJobs.get(requestId);
            if (cancelled != null) cancelled.set(true);
            // Acknowledge immediately; the in-flight extractZip call is the
            // one that will actually reject with "CANCELLED" once it notices.
            callback.success();
            return true;
        }

        return false;
    }

    private void extractZip(
            String zipPath,
            String destDirUri,
            String pluginJsonOverride,
            JSONObject existingState,
            AtomicBoolean cancelled,
            CallbackContext callback
    ) {
        final File destDir;
        final File zipFileOnDisk;
        try {
            destDir = uriToFile(destDirUri);
            zipFileOnDisk = uriToFile(zipPath);
        } catch (Exception e) {
            callback.error("INVALID_PATH: " + e.getMessage());
            return;
        }

        if (!destDir.exists() && !destDir.mkdirs()) {
            callback.error("CANNOT_CREATE_DEST_DIR");
            return;
        }

        if (!zipFileOnDisk.isFile()) {
            callback.error("ZIP_NOT_FOUND: " + zipPath);
            return;
        }

        // relativePath(lowercase) -> sha256 hex, mirrors installState.js's store
        JSONObject updatedStore = new JSONObject();
        List<String> skippedUnsafe = new ArrayList<>();
        // Entries that failed to read/write - collected so one bad file
        // doesn't abort the rest of the install, matching the old JS
        // behaviour of logging per-file errors and continuing.
        List<String> failed = new ArrayList<>();
        long totalUncompressed = 0;

        try (ZipFile zip = new ZipFile(zipFileOnDisk)) {
            int total = zip.size();
            int processed = 0;

            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                if (cancelled.get()) throw new CancelledException();

                ZipEntry entry = entries.nextElement();
                processed++;

                if (processed == 1 || processed == total || processed % PROGRESS_STEP == 0) {
                    sendProgress(callback, processed, total);
                }

                String rawName = entry.getName();

                if (isUnsafeAbsolutePath(rawName)) {
                    skippedUnsafe.add(rawName);
                    continue;
                }

                boolean isDirEntry = entry.isDirectory() || rawName.replace('\\', '/').endsWith("/");
                String safeRelative = sanitizeZipPath(rawName, isDirEntry);

                if (safeRelative.isEmpty()) continue;

                File outFile = new File(destDir, safeRelative);

                // Defense in depth: even after sanitizing, make sure we never
                // end up writing outside destDir. This is a cheap, purely
                // lexical check (no filesystem/symlink resolution) since
                // sanitizeZipPath already guarantees no ".." can survive.
                if (!isChild(destDir, outFile)) {
                    skippedUnsafe.add(rawName);
                    continue;
                }

                if (isDirEntry) {
                    outFile.mkdirs();
                    continue;
                }

                long declaredSize = entry.getSize(); // reliable for ZipFile (read from central directory)
                if (declaredSize > MAX_ENTRY_SIZE) {
                    Log.w(TAG, "Skipping oversized entry " + rawName + " (" + declaredSize + " bytes)");
                    failed.add(rawName);
                    continue;
                }

                byte[] content;
                try (InputStream in = zip.getInputStream(entry)) {
                    content = readAllBytesCapped(in, MAX_ENTRY_SIZE, cancelled);
                } catch (IOException e) {
                    Log.e(TAG, "Failed reading " + rawName, e);
                    failed.add(rawName);
                    continue;
                }

                totalUncompressed += content.length;
                if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_SIZE) {
                    callback.error("ARCHIVE_TOO_LARGE");
                    return;
                }

                // plugin.json is patched on the JS side before install
                // (resolved main/icon/readme, source url, id, ...) - always
                // persist that copy instead of the archive's own bytes.
                if (pluginJsonOverride != null && PLUGIN_MANIFEST.equals(safeRelative)) {
                    content = toUtf8(pluginJsonOverride);
                }

                String key = safeRelative.toLowerCase();
                String newChecksum = sha256Hex(content);
                String oldChecksum = existingState.optString(key, null);

                try {
                    if (oldChecksum == null || !oldChecksum.equals(newChecksum)) {
                        writeFile(outFile, content);
                    }
                    updatedStore.put(key, newChecksum);
                } catch (IOException e) {
                    Log.e(TAG, "Failed writing " + safeRelative, e);
                    failed.add(safeRelative);
                } catch (JSONException e) {
                    Log.e(TAG, "State error for " + safeRelative, e);
                    failed.add(safeRelative);
                }
            }
        } catch (CancelledException e) {
            callback.error("CANCELLED");
            return;
        } catch (IOException e) {
            callback.error("EXTRACT_FAILED: " + e.getMessage());
            return;
        }

        try {
            JSONObject result = new JSONObject();
            result.put("store", updatedStore);
            result.put("skippedUnsafe", new JSONArray(skippedUnsafe));
            result.put("failed", new JSONArray(failed));

            PluginResult pluginResult = new PluginResult(PluginResult.Status.OK, result);
            pluginResult.setKeepCallback(false);
            callback.sendPluginResult(pluginResult);
        } catch (JSONException e) {
            callback.error("RESULT_ERROR: " + e.getMessage());
        }
    }

    /** Sends a non-terminal progress update; the callback stays open until the final result. */
    private void sendProgress(CallbackContext callback, int done, int total) {
        try {
            JSONObject progress = new JSONObject();
            progress.put("type", "progress");
            progress.put("done", done);
            progress.put("total", total);

            PluginResult pluginResult = new PluginResult(PluginResult.Status.OK, progress);
            pluginResult.setKeepCallback(true);
            callback.sendPluginResult(pluginResult);
        } catch (JSONException ignored) {
            // Progress reporting is best-effort; never let it break extraction.
        }
    }

    private byte[] readAllBytesCapped(InputStream in, long cap, AtomicBoolean cancelled) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[BUFFER_SIZE];
        long total = 0;
        int len;

        while ((len = in.read(buffer)) > 0) {
            if (cancelled.get()) throw new CancelledException();

            total += len;
            if (total > cap) {
                throw new IOException("Entry exceeds max allowed size of " + cap + " bytes");
            }
            out.write(buffer, 0, len);
        }

        return out.toByteArray();
    }

    /**
     * Writes content via a temp sibling file + atomic rename, so a write
     * that fails partway through (disk full, I/O error) can never leave a
     * corrupted, half-written file at the final path - either the previous
     * content stays untouched, or the new content lands in one atomic swap.
     */
    private void writeFile(File file, byte[] content) throws IOException {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();

        File tmp = new File(parent, file.getName() + ".part-" + System.nanoTime());
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(content);
            fos.getFD().sync();
        } catch (IOException e) {
            tmp.delete();
            throw e;
        }

        if (!tmp.renameTo(file)) {
            tmp.delete();
            throw new IOException("Failed to move extracted file into place: " + file);
        }
    }

    /** Resolves a `file://` URI (or an already-plain path) to a File. */
    private File uriToFile(String uriOrPath) {
        Uri uri = Uri.parse(uriOrPath);
        String path = uri.getPath();

        if ("file".equals(uri.getScheme()) && path != null) {
            return new File(path);
        }

        // No recognizable scheme - treat the input as an already-plain path.
        return new File(uriOrPath);
    }

    /**
     * Purely lexical containment check (no filesystem access / symlink
     * resolution): is `child` located under `parent` once both paths are
     * normalized? Used as a defense-in-depth net on top of sanitizeZipPath,
     * which already removes any ".." or absolute segments.
     */
    private boolean isChild(File parent, File child) {
        Path parentPath = parent.toPath().normalize();
        Path childPath = child.toPath().normalize();
        return childPath.startsWith(parentPath);
    }

    private byte[] toUtf8(String s) {
        try {
            return s.getBytes("UTF-8");
        } catch (UnsupportedEncodingException e) {
            // UTF-8 is guaranteed to be available on Android.
            return s.getBytes();
        }
    }

    private String sha256Hex(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(data);
            StringBuilder hex = new StringBuilder(hash.length * 2);

            for (byte b : hash) {
                String h = Integer.toHexString(0xff & b);
                if (h.length() == 1) hex.append('0');
                hex.append(h);
            }

            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is guaranteed to be available on Android.
            throw new RuntimeException(e);
        }
    }

    /**
     * Mirrors installPlugin.js#sanitizeZipPath: normalizes separators to
     * '/', strips leading slashes and Windows drive prefixes (e.g. "C:/"),
     * resolves "." and ".." segments, and preserves a trailing slash for
     * directory entries. The result is always a path relative to destDir.
     */
    private String sanitizeZipPath(String p, boolean isDir) {
        if (p == null || p.isEmpty()) return "";

        String path = p.replace('\\', '/');
        path = path.replaceFirst("^[a-zA-Z][a-zA-Z0-9+.-]*://", "");
        path = path.replaceFirst("^/+", "");
        path = path.replaceFirst("^[A-Za-z]:/", "");

        String[] parts = path.split("/");
        List<String> stack = new ArrayList<>();

        for (String part : parts) {
            if (part.isEmpty() || ".".equals(part)) continue;
            if ("..".equals(part)) {
                if (!stack.isEmpty()) stack.remove(stack.size() - 1);
                continue;
            }
            stack.add(part);
        }

        StringBuilder safe = new StringBuilder();
        for (int i = 0; i < stack.size(); i++) {
            if (i > 0) safe.append('/');
            safe.append(stack.get(i));
        }

        if (isDir && safe.length() > 0 && safe.charAt(safe.length() - 1) != '/') {
            safe.append('/');
        }

        return safe.toString();
    }

    /**
     * Mirrors installPlugin.js#isUnsafeAbsolutePath: any entry with a
     * leading slash (including Android/Linux device roots such as
     * "/data"), a Windows drive root, or a UNC/network path is rejected
     * outright instead of being rebased under destDir.
     */
    private boolean isUnsafeAbsolutePath(String p) {
        if (p == null || p.isEmpty()) return false;
        if (p.matches("^[A-Za-z]:[\\\\/].*")) return true; // Windows drive root
        if (p.startsWith("//") || p.startsWith("\\\\")) return true; // network path
        if (p.startsWith("/")) return true; // any leading slash is unsafe
        return false;
    }
}