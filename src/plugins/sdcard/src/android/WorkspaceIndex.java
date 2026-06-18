package com.foxdebug.sdcard;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

class WorkspaceIndex {
  private static final String TAG = "WorkspaceIndex";
  private static final String SEPARATOR = "::";
  private static final int DB_VERSION = 1;
  private static final int BATCH_SIZE = 200;
  private static final int MAX_INDEXED_CHARS = 512 * 1024;
  private static final int INDEX_READ_LIMIT_BYTES = MAX_INDEXED_CHARS * 4;
  private static final int DIRECT_SEARCH_READ_LIMIT_BYTES = 16 * 1024 * 1024;
  private static final int EXPLICIT_INCLUDE_READ_LIMIT_BYTES = 128 * 1024 * 1024;
  private static final int SAMPLE_BYTES = 8192;
  private static final int MAX_MATCHES_PER_FILE = 5000;

  private static final Set<String> BINARY_EXTENSIONS = new HashSet<>();
  private static final Set<String> TEXT_EXTENSIONS = new HashSet<>();
  private static final Set<String> BINARY_MIME_TYPES = new HashSet<>();
  private static final Set<String> TEXT_MIME_TYPES = new HashSet<>();

  static {
    Collections.addAll(
      BINARY_EXTENSIONS,
      "3gp",
      "7z",
      "aab",
      "aac",
      "apk",
      "avi",
      "bin",
      "bmp",
      "class",
      "db",
      "dex",
      "dll",
      "doc",
      "docx",
      "eot",
      "exe",
      "flac",
      "gif",
      "gz",
      "heic",
      "ico",
      "jar",
      "jpeg",
      "jpg",
      "keystore",
      "m4a",
      "m4v",
      "mkv",
      "mov",
      "mp3",
      "mp4",
      "o",
      "odt",
      "ogg",
      "otf",
      "pdf",
      "png",
      "ppt",
      "pptx",
      "pyc",
      "rar",
      "so",
      "sqlite",
      "sqlite3",
      "tar",
      "tgz",
      "ttf",
      "wav",
      "webm",
      "webp",
      "woff",
      "woff2",
      "xls",
      "xlsx",
      "xz",
      "zip"
    );
    Collections.addAll(
      TEXT_EXTENSIONS,
      "astro",
      "c",
      "cc",
      "cfg",
      "conf",
      "cpp",
      "cs",
      "css",
      "csv",
      "cxx",
      "dart",
      "env",
      "go",
      "graphql",
      "h",
      "hpp",
      "htm",
      "html",
      "java",
      "js",
      "json",
      "jsx",
      "kt",
      "kts",
      "less",
      "lua",
      "md",
      "mjs",
      "php",
      "properties",
      "py",
      "rb",
      "rs",
      "sass",
      "scss",
      "sh",
      "sql",
      "svg",
      "swift",
      "toml",
      "ts",
      "tsx",
      "txt",
      "vue",
      "xml",
      "yaml",
      "yml"
    );
    Collections.addAll(
      BINARY_MIME_TYPES,
      "application/java-archive",
      "application/java-vm",
      "application/octet-stream",
      "application/pdf",
      "application/vnd.android.package-archive",
      "application/zip",
      "application/x-7z-compressed",
      "application/x-rar-compressed",
      "application/x-sqlite3",
      "application/x-tar",
      "application/x-xz"
    );
    Collections.addAll(
      TEXT_MIME_TYPES,
      "application/javascript",
      "application/json",
      "application/ld+json",
      "application/sql",
      "application/typescript",
      "application/x-javascript",
      "application/x-php",
      "application/x-sh",
      "application/x-yaml",
      "application/xhtml+xml",
      "application/xml",
      "image/svg+xml"
    );
  }

  private final Context context;
  private final ContentResolver resolver;
  private final ExecutorService executor = Executors.newFixedThreadPool(2);
  private final Map<String, Job> jobs = new ConcurrentHashMap<>();
  private final DB db;

  WorkspaceIndex(Context context) {
    this.context = context.getApplicationContext();
    this.resolver = context.getContentResolver();
    this.db = new DB(this.context);
  }

  void scan(JSONObject options, CallbackContext callback) {
    final String id = options.optString("id", UUID.randomUUID().toString());
    final Job job = new Job(id);
    jobs.put(id, job);

    executor.execute(
      () -> {
        try {
          runScan(job, options, callback);
        } catch (Exception error) {
          sendError(callback, id, error);
        } finally {
          jobs.remove(id);
        }
      }
    );
  }

  void search(JSONObject options, CallbackContext callback) {
    final String id = options.optString("id", UUID.randomUUID().toString());
    final Job job = new Job(id);
    jobs.put(id, job);

    executor.execute(
      () -> {
        try {
          runSearch(job, options, callback);
        } catch (Exception error) {
          sendError(callback, id, error);
        } finally {
          jobs.remove(id);
        }
      }
    );
  }

  void cancel(String id) {
    Job job = jobs.get(id);
    if (job != null) job.cancelled = true;
  }

  void markDirty(JSONArray urls) {
    SQLiteDatabase writable = db.getWritableDatabase();
    for (int i = 0; i < urls.length(); i++) {
      String url = urls.optString(i, null);
      if (url == null || url.length() == 0) continue;
      writable.delete("content", "url = ?", new String[] { url });
    }
  }

  void clear(JSONArray roots) {
    SQLiteDatabase writable = db.getWritableDatabase();
    if (roots == null || roots.length() == 0) {
      writable.delete("content", null, null);
      writable.delete("files", null, null);
      writable.delete("workspaces", null, null);
      return;
    }

    for (int i = 0; i < roots.length(); i++) {
      String root = roots.optString(i, null);
      if (root == null || root.length() == 0) continue;
      writable.delete("content", "url IN (SELECT url FROM files WHERE root_url = ?)", new String[] { root });
      writable.delete("files", "root_url = ?", new String[] { root });
      writable.delete("workspaces", "root_url = ?", new String[] { root });
    }
  }

  private void runScan(Job job, JSONObject options, CallbackContext callback)
    throws Exception {
    String rootUrl = options.getString("rootUrl");
    String title = options.optString("title", basename(rootUrl));
    JSONArray exclude = options.optJSONArray("excludeFolders");
    boolean showHiddenFiles = options.optBoolean("showHiddenFiles", false);
    String defaultEncoding = options.optString("defaultEncoding", "UTF-8");
    boolean indexContent = options.optBoolean("indexContent", false);

    JSONArray batch = new JSONArray();
    ScanStats stats = new ScanStats();

    sendStatus(callback, job.id, "scanning", "Scanning project files", 0, true);

    SQLiteDatabase writable = db.getWritableDatabase();
    writable.beginTransaction();
    try {
      ContentValues workspace = new ContentValues();
      workspace.put("root_url", rootUrl);
      workspace.put("title", title);
      workspace.put("indexed_at", System.currentTimeMillis());
      workspace.put("options_hash", String.valueOf(options.toString().hashCode()));
      writable.replace("workspaces", null, workspace);
      writable.delete("files", "root_url = ?", new String[] { rootUrl });

      if (isSafUrl(rootUrl)) {
        SafUrl rootSafUrl = parseSafUrl(rootUrl);
        scanSafDir(
          job,
          callback,
          rootSafUrl.treeUrl,
          rootUrl,
          rootSafUrl.docId,
          rootUrl,
          title,
          title,
          exclude,
          showHiddenFiles,
          defaultEncoding,
          indexContent,
          batch,
          stats
        );
      } else {
        File rootFile = fileFromUrl(rootUrl);
        scanFileDir(
          job,
          callback,
          rootUrl,
          rootFile,
          rootUrl,
          title,
          title,
          exclude,
          showHiddenFiles,
          defaultEncoding,
          indexContent,
          batch,
          stats
        );
      }

      if (job.cancelled) return;
      flushBatch(callback, job.id, batch);
      writable.setTransactionSuccessful();
    } finally {
      writable.endTransaction();
    }

    JSONObject done = baseEvent(job.id, "done");
    done.put("files", stats.files);
    done.put("dirs", stats.dirs);
    done.put("indexed", stats.indexed);
    send(callback, done, false);
  }

  private void scanFileDir(
    Job job,
    CallbackContext callback,
    String rootUrl,
    File dir,
    String parentUrl,
    String parentPath,
    String title,
    JSONArray exclude,
    boolean showHiddenFiles,
    String defaultEncoding,
    boolean indexContent,
    JSONArray batch,
    ScanStats stats
  ) throws Exception {
    if (job.cancelled || dir == null) return;
    File[] children = dir.listFiles();
    if (children == null) return;

    for (File child : children) {
      if (job.cancelled) return;
      String name = child.getName();
      if (!showHiddenFiles && name.startsWith(".")) continue;

      boolean isDir = child.isDirectory();
      String url = Uri.fromFile(child).toString();
      String path = joinPath(parentPath, name);
      String mime = isDir ? Document.MIME_TYPE_DIR : normalizeMime(name, guessMime(name));
      FileEntry entry = new FileEntry(
        rootUrl,
        parentUrl,
        url,
        name,
        path,
        mime,
        isDir,
        child.length(),
        child.lastModified()
      );

      addEntry(callback, job.id, batch, entry, stats);
      if (isDir) {
        if (isExcluded(path + "/", exclude)) continue;
        scanFileDir(
          job,
          callback,
          rootUrl,
          child,
          url,
          path,
          title,
          exclude,
          showHiddenFiles,
          defaultEncoding,
          indexContent,
          batch,
          stats
        );
      } else {
        if (indexContent) {
          indexFile(entry, defaultEncoding);
          stats.indexed += 1;
        }
      }
    }
  }

  private void scanSafDir(
    Job job,
    CallbackContext callback,
    String treeUrl,
    String rootUrl,
    String parentDocId,
    String parentUrl,
    String parentPath,
    String title,
    JSONArray exclude,
    boolean showHiddenFiles,
    String defaultEncoding,
    boolean indexContent,
    JSONArray batch,
    ScanStats stats
  ) throws Exception {
    if (job.cancelled) return;
    Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
      Uri.parse(treeUrl),
      parentDocId
    );
    Cursor cursor = null;
    try {
      cursor =
        resolver.query(
          childrenUri,
          new String[] {
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE,
            Document.COLUMN_LAST_MODIFIED,
          },
          null,
          null,
          null
        );
      if (cursor == null) return;

      while (cursor.moveToNext()) {
        if (job.cancelled) return;
        String docId = cursor.getString(0);
        String name = cursor.getString(1);
        String mime = normalizeMime(name, cursor.getString(2));
        long size = safeLong(cursor, 3);
        long modified = safeLong(cursor, 4);

        if (!showHiddenFiles && name != null && name.startsWith(".")) continue;

        boolean isDir = Document.MIME_TYPE_DIR.equals(mime);
        String url = treeUrl + SEPARATOR + docId;
        String path = joinPath(parentPath, name);
        FileEntry entry = new FileEntry(
          rootUrl,
          parentUrl,
          url,
          name,
          path,
          mime,
          isDir,
          size,
          modified
        );

        addEntry(callback, job.id, batch, entry, stats);
        if (isDir) {
          if (isExcluded(path + "/", exclude)) continue;
          scanSafDir(
            job,
            callback,
            treeUrl,
            rootUrl,
            docId,
            url,
            path,
            title,
            exclude,
            showHiddenFiles,
            defaultEncoding,
            indexContent,
            batch,
            stats
          );
        } else {
          if (indexContent) {
            indexFile(entry, defaultEncoding);
            stats.indexed += 1;
          }
        }
      }
    } finally {
      if (cursor != null) cursor.close();
    }
  }

  private void addEntry(
    CallbackContext callback,
    String id,
    JSONArray batch,
    FileEntry entry,
    ScanStats stats
  ) throws Exception {
    saveFile(entry);
    batch.put(entry.toJSON());
    if (entry.isDirectory) stats.dirs += 1; else stats.files += 1;
    if (batch.length() >= BATCH_SIZE) {
      flushBatch(callback, id, batch);
    }
  }

  private void flushBatch(CallbackContext callback, String id, JSONArray batch)
    throws JSONException {
    if (batch.length() == 0) return;
    JSONObject event = baseEvent(id, "batch");
    event.put("entries", new JSONArray(batch.toString()));
    send(callback, event, true);
    while (batch.length() > 0) batch.remove(0);
  }

  private void runSearch(Job job, JSONObject options, CallbackContext callback)
    throws Exception {
    JSONArray files = options.optJSONArray("files");
    if (files == null) files = new JSONArray();
    String search = options.optString("search", "");
    String replace = options.optString("replace", null);
    String mode = options.optString("mode", "search");
    JSONObject searchOptions = options.optJSONObject("options");
    if (searchOptions == null) searchOptions = new JSONObject();
    JSONObject overlays = options.optJSONObject("overlays");
    if (overlays == null) overlays = new JSONObject();
    String defaultEncoding = options.optString("defaultEncoding", "UTF-8");
    boolean useIndex = options.optBoolean("useIndex", false);

    Pattern pattern = compileSearchPattern(search, searchOptions);
    int total = files.length();
    int processed = 0;

    sendStatus(callback, job.id, "searching", "Searching files", 0, true);

    for (int i = 0; i < total; i++) {
      if (job.cancelled) return;
      JSONObject file = files.getJSONObject(i);
      sendProgress(callback, job.id, total == 0 ? 100 : (processed * 100) / total);
      sendStatus(
        callback,
        job.id,
        "searching",
        "Searching " + file.optString("name", "file"),
        total == 0 ? 100 : (processed * 100) / total,
        true
      );
      if (!isSupportedUrl(file.optString("url"))) {
        processed += 1;
        continue;
      }
      if (shouldSkipSearchFile(file, searchOptions)) {
        processed += 1;
        continue;
      }

      boolean allowLargeFile = isExplicitlyIncluded(file, searchOptions);
      String content = getFileContent(
        file,
        overlays,
        defaultEncoding,
        useIndex,
        allowLargeFile,
        callback,
        job.id,
        total,
        processed
      );
      if (content == null) {
        processed += 1;
        sendProgress(callback, job.id, total == 0 ? 100 : (processed * 100) / total);
        continue;
      }

      if ("replace".equals(mode)) {
        String text = pattern.matcher(content).replaceAll(replace == null ? "" : replace);
        JSONObject result = baseEvent(job.id, "replace-result");
        result.put("file", file);
        result.put("text", text);
        send(callback, result, true);
      } else {
        JSONObject result = searchInContent(job.id, file, content, pattern);
        if (result != null) send(callback, result, true);
      }

      processed += 1;
      sendProgress(callback, job.id, total == 0 ? 100 : (processed * 100) / total);
    }

    sendProgress(callback, job.id, 100);
    send(callback, baseEvent(job.id, "replace".equals(mode) ? "done-replacing" : "done-searching"), false);
  }

  private Pattern compileSearchPattern(String search, JSONObject options)
    throws PatternSyntaxException {
    boolean regExp = options.optBoolean("regExp", false);
    boolean wholeWord = options.optBoolean("wholeWord", false);
    boolean caseSensitive = options.optBoolean("caseSensitive", false);

    String pattern = regExp ? search : Pattern.quote(search);
    if (wholeWord) pattern = "\\b" + pattern + "\\b";

    int flags = Pattern.MULTILINE;
    if (!caseSensitive) flags |= Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;
    return Pattern.compile(pattern, flags);
  }

  private JSONObject searchInContent(
    String id,
    JSONObject file,
    String content,
    Pattern pattern
  ) throws JSONException {
    Matcher matcher = pattern.matcher(content);
    JSONArray matches = new JSONArray();
    StringBuilder text = new StringBuilder(file.optString("name"));
    if (text.length() > 30) {
      text = new StringBuilder("..." + text.substring(text.length() - 30));
    }

    boolean limited = false;
    int cursor = 0;
    int row = 0;
    int column = 0;
    while (matcher.find()) {
      if (matches.length() >= MAX_MATCHES_PER_FILE) {
        limited = true;
        break;
      }
      String word = matcher.group();
      int start = matcher.start();
      int end = matcher.end();
      String[] surrounding = getSurrounding(content, word, start, end);
      while (cursor < start) {
        if (content.charAt(cursor) == '\n') {
          row += 1;
          column = 0;
        } else {
          column += 1;
        }
        cursor += 1;
      }
      JSONObject startPosition = lineColumn(row, column);
      while (cursor < end) {
        if (content.charAt(cursor) == '\n') {
          row += 1;
          column = 0;
        } else {
          column += 1;
        }
        cursor += 1;
      }
      JSONObject endPosition = lineColumn(row, column);
      JSONObject match = new JSONObject();
      match.put("match", word);
      match.put("renderText", surrounding[1]);
      match.put("line", surrounding[0].trim());
      match.put("position", position(startPosition, endPosition));
      matches.put(match);
      text.append("\n\t").append(surrounding[0].trim());
    }

    if (matches.length() == 0) return null;

    JSONObject data = new JSONObject();
    data.put("file", file);
    data.put("matches", matches);
    if (limited) {
      text
        .append("\n\t")
        .append("... result limit reached for this file");
    }
    data.put("limited", limited);
    data.put("text", text.toString());

    JSONObject event = baseEvent(id, "search-result");
    event.put("data", data);
    return event;
  }

  private String getFileContent(
    JSONObject file,
    JSONObject overlays,
    String defaultEncoding,
    boolean useIndex,
    boolean allowLargeFile,
    CallbackContext callback,
    String jobId,
    int totalFiles,
    int processedFiles
  ) throws Exception {
    String url = file.optString("url");
    if (overlays.has(url)) return overlays.optString(url, "");

    long size = file.optLong("size", 0);
    long modified = normalizeModified(file);

    if (useIndex) {
      SQLiteDatabase readable = db.getReadableDatabase();
      Cursor cursor = null;
      try {
        cursor =
          readable.query(
            "content",
            new String[] { "text", "size", "modified_date" },
            "url = ?",
            new String[] { url },
            null,
            null,
            null
          );
        if (cursor != null && cursor.moveToFirst()) {
          long cachedSize = cursor.getLong(1);
          long cachedModified = cursor.getLong(2);
          if ((size == 0 || cachedSize == size) && (modified == 0 || cachedModified == modified)) {
            return cursor.getString(0);
          }
        }
      } finally {
        if (cursor != null) cursor.close();
      }
    }

    FileEntry entry = FileEntry.fromJSON(file);
    if (useIndex && !allowLargeFile) {
      String indexed = indexFile(entry, defaultEncoding);
      if (indexed != null) return indexed;
    }
    return readFileText(
      entry,
      defaultEncoding,
      allowLargeFile ? EXPLICIT_INCLUDE_READ_LIMIT_BYTES : DIRECT_SEARCH_READ_LIMIT_BYTES,
      allowLargeFile ? EXPLICIT_INCLUDE_READ_LIMIT_BYTES : DIRECT_SEARCH_READ_LIMIT_BYTES,
      callback,
      jobId,
      totalFiles,
      processedFiles
    );
  }

  private String indexFile(FileEntry entry, String defaultEncoding) {
    if (entry.isDirectory || isBinary(entry) || entry.size > INDEX_READ_LIMIT_BYTES) {
      return null;
    }

    try {
      String text = readFileText(
        entry,
        defaultEncoding,
        INDEX_READ_LIMIT_BYTES,
        MAX_INDEXED_CHARS,
        null,
        null,
        0,
        0
      );
      if (text == null) return null;
      String encoding = normalizeEncoding(defaultEncoding);

      ContentValues values = new ContentValues();
      values.put("url", entry.url);
      values.put("size", entry.size);
      values.put("modified_date", entry.modifiedDate);
      values.put("encoding", encoding);
      values.put("text", text);
      values.put("lower_text", text.toLowerCase(Locale.ROOT));
      values.put("indexed_at", System.currentTimeMillis());
      db.getWritableDatabase().replace("content", null, values);
      return text;
    } catch (Exception error) {
      Log.d(TAG, "Unable to index " + entry.url, error);
      return null;
    }
  }

  private String readFileText(
    FileEntry entry,
    String defaultEncoding,
    int readLimitBytes,
    int maxChars,
    CallbackContext callback,
    String jobId,
    int totalFiles,
    int processedFiles
  )
    throws Exception {
    if (entry.isDirectory || isBinary(entry) || entry.size > readLimitBytes) {
      return null;
    }

    byte[] bytes = readBytes(
      entry.url,
      readLimitBytes + 1,
      callback,
      jobId,
      totalFiles,
      processedFiles,
      entry.size
    );
    if (bytes.length > readLimitBytes) return null;
    String encoding = detectEncoding(bytes, defaultEncoding);
    if (isSingleByteEncoding(encoding) && looksBinary(bytes)) return null;
    String text = new String(bytes, Charset.forName(encoding));
    if (text.length() > maxChars || hasBinaryChars(text)) return null;
    return text;
  }

  private byte[] readBytes(
    String url,
    int limit,
    CallbackContext callback,
    String jobId,
    int totalFiles,
    int processedFiles,
    long fileSize
  ) throws Exception {
    InputStream input = null;
    try {
      if (isSafUrl(url)) {
        input = resolver.openInputStream(formatSafUri(url));
      } else {
        input = new FileInputStream(fileFromUrl(url));
      }
      if (input == null) return new byte[0];

      ByteArrayOutputStream output = new ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int read;
      int total = 0;
      int lastProgress = -1;
      while ((read = input.read(buffer)) != -1) {
        total += read;
        if (callback != null && jobId != null && totalFiles > 0) {
          long denominator = fileSize > 0 ? fileSize : limit;
          int fileProgress = (int) Math.min(99, (total * 100L) / denominator);
          int progress = ((processedFiles * 100) + fileProgress) / totalFiles;
          if (progress != lastProgress) {
            sendProgress(callback, jobId, progress);
            lastProgress = progress;
          }
        }
        if (total > limit) {
          output.write(buffer, 0, read - (total - limit));
          break;
        }
        output.write(buffer, 0, read);
      }
      return output.toByteArray();
    } finally {
      if (input != null) input.close();
    }
  }

  private void saveFile(FileEntry entry) {
    ContentValues values = new ContentValues();
    values.put("url", entry.url);
    values.put("root_url", entry.rootUrl);
    values.put("parent_url", entry.parentUrl);
    values.put("path", entry.path);
    values.put("name", entry.name);
    values.put("mime", entry.mime);
    values.put("is_directory", entry.isDirectory ? 1 : 0);
    values.put("size", entry.size);
    values.put("modified_date", entry.modifiedDate);
    values.put("indexed_at", System.currentTimeMillis());
    values.put("skipped_reason", isBinary(entry) ? "binary" : null);
    db.getWritableDatabase().replace("files", null, values);
  }

  private boolean shouldSkipSearchFile(JSONObject file, JSONObject options) {
    if (FileEntry.fromJSON(file).isBinary()) return true;
    String path = file.optString("path", "");
    if (path.length() == 0) return false;

    JSONArray excludes = splitPatterns(options.optString("exclude", ""));
    JSONArray includes = splitPatterns(options.optString("include", ""));
    if (includes.length() == 0) includes.put("**");

    return matchesAny(path, excludes) || !matchesAny(path, includes);
  }

  private boolean isExplicitlyIncluded(JSONObject file, JSONObject options) {
    String path = file.optString("path", "");
    if (path.length() == 0) return false;
    JSONArray includes = splitPatterns(options.optString("include", ""));
    return includes.length() > 0 && matchesAny(path, includes);
  }

  private JSONArray splitPatterns(String value) {
    JSONArray result = new JSONArray();
    if (value == null || value.trim().length() == 0) return result;
    String[] patterns = value.split(",");
    for (String pattern : patterns) {
      String item = pattern.trim();
      if (item.length() > 0) result.put(item);
    }
    return result;
  }

  private boolean isExcluded(String path, JSONArray excludes) {
    return matchesAny(path, excludes);
  }

  private boolean matchesAny(String path, JSONArray patterns) {
    if (patterns == null) return false;
    for (int i = 0; i < patterns.length(); i++) {
      String pattern = patterns.optString(i, "");
      if (globMatches(path, pattern)) return true;
    }
    return false;
  }

  private boolean globMatches(String path, String pattern) {
    if (pattern == null || pattern.length() == 0) return false;
    String normalizedPath = path.replace('\\', '/');
    String normalizedPattern = pattern.replace('\\', '/');
    if ("**".equals(normalizedPattern)) return true;

    String regex = globToRegex(normalizedPattern);
    Pattern compiled = Pattern.compile(regex);
    if (compiled.matcher(normalizedPath).matches()) return true;

    int slash = normalizedPath.lastIndexOf('/');
    String basename = slash >= 0 ? normalizedPath.substring(slash + 1) : normalizedPath;
    return compiled.matcher(basename).matches();
  }

  private String globToRegex(String glob) {
    StringBuilder regex = new StringBuilder("^");
    for (int i = 0; i < glob.length(); i++) {
      char ch = glob.charAt(i);
      if (ch == '*') {
        boolean doublestar = i + 1 < glob.length() && glob.charAt(i + 1) == '*';
        if (doublestar) {
          i++;
          if (i + 1 < glob.length() && glob.charAt(i + 1) == '/') {
            regex.append("(?:.*/)?");
            i++;
          } else {
            regex.append(".*");
          }
        } else {
          regex.append("[^/]*");
        }
      } else if (ch == '?') {
        regex.append('.');
      } else if ("\\.[]{}()+-^$|".indexOf(ch) >= 0) {
        regex.append('\\').append(ch);
      } else {
        regex.append(ch);
      }
    }
    regex.append('$');
    return regex.toString();
  }

  private boolean isBinary(FileEntry entry) {
    return entry.isBinary();
  }

  private String detectEncoding(byte[] bytes, String defaultEncoding) {
    if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xef && (bytes[1] & 0xff) == 0xbb && (bytes[2] & 0xff) == 0xbf) {
      return "UTF-8";
    }
    if (bytes.length >= 2 && (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xfe) {
      return "UTF-16LE";
    }
    if (bytes.length >= 2 && (bytes[0] & 0xff) == 0xfe && (bytes[1] & 0xff) == 0xff) {
      return "UTF-16BE";
    }
    String utf16 = detectUtf16ByNullPattern(bytes);
    if (utf16 != null) return utf16;
    return normalizeEncoding(defaultEncoding);
  }

  private String detectUtf16ByNullPattern(byte[] bytes) {
    int sample = Math.min(bytes.length, SAMPLE_BYTES);
    if (sample < 8) return null;

    int evenNulls = 0;
    int oddNulls = 0;
    int pairs = sample / 2;
    for (int i = 0; i + 1 < sample; i += 2) {
      if (bytes[i] == 0) evenNulls++;
      if (bytes[i + 1] == 0) oddNulls++;
    }
    if (oddNulls > pairs * 0.35 && evenNulls < pairs * 0.05) return "UTF-16LE";
    if (evenNulls > pairs * 0.35 && oddNulls < pairs * 0.05) return "UTF-16BE";
    return null;
  }

  private boolean isSingleByteEncoding(String encoding) {
    String normalized = encoding == null ? "" : encoding.toUpperCase(Locale.ROOT);
    return !normalized.startsWith("UTF-16") && !normalized.startsWith("UTF-32");
  }

  private boolean looksBinary(byte[] bytes) {
    int sample = Math.min(bytes.length, SAMPLE_BYTES);
    if (sample == 0) return false;

    int control = 0;
    int high = 0;
    for (int i = 0; i < sample; i++) {
      int value = bytes[i] & 0xff;
      if (value == 0) return true;
      if (
        value < 32 &&
        value != 9 &&
        value != 10 &&
        value != 13 &&
        value != 12
      ) {
        control++;
      }
      if (value >= 0x80) high++;
    }
    return control > Math.max(8, sample * 0.02) && high < sample * 0.5;
  }

  private String normalizeEncoding(String defaultEncoding) {
    if (defaultEncoding == null || defaultEncoding.equals("auto") || defaultEncoding.length() == 0) {
      return "UTF-8";
    }
    try {
      if (Charset.isSupported(defaultEncoding)) return defaultEncoding;
    } catch (Exception ignored) {}
    return "UTF-8";
  }

  private boolean hasBinaryChars(String text) {
    int len = Math.min(text.length(), 2048);
    for (int i = 0; i < len; i++) {
      char ch = text.charAt(i);
      if (
        (ch >= 0 && ch <= 8) ||
        ch == 11 ||
        (ch >= 14 && ch <= 31) ||
        ch == 127
      ) {
        return true;
      }
    }
    return false;
  }

  private JSONObject position(JSONObject start, JSONObject end) throws JSONException {
    JSONObject position = new JSONObject();
    position.put("start", start);
    position.put("end", end);
    return position;
  }

  private JSONObject lineColumn(int row, int column) throws JSONException {
    JSONObject result = new JSONObject();
    result.put("row", row);
    result.put("column", column);
    return result;
  }

  private String[] getSurrounding(String content, String word, int start, int end) {
    int max = 160;
    int lineStart = start;
    while (lineStart > 0) {
      char previous = content.charAt(lineStart - 1);
      if (previous == '\n' || previous == '\r') break;
      lineStart--;
    }

    int lineEnd = end;
    while (lineEnd < content.length()) {
      char current = content.charAt(lineEnd);
      if (current == '\n' || current == '\r') break;
      lineEnd++;
    }

    int snippetStart = lineStart;
    int snippetEnd = lineEnd;
    if (lineEnd - lineStart > max) {
      int matchLength = Math.max(1, end - start);
      int remaining = Math.max(0, max - matchLength);
      int left = remaining / 2;
      int right = remaining - left;
      snippetStart = Math.max(lineStart, start - left);
      snippetEnd = Math.min(lineEnd, end + right);
    }

    StringBuilder line = new StringBuilder();
    if (snippetStart > lineStart) line.append("...");
    line.append(content.substring(snippetStart, snippetEnd).trim());
    if (snippetEnd < lineEnd) line.append("...");
    String renderText = word;

    return new String[] {
      line.toString().replaceAll("[\\r\\n]+", " ⏎ "),
      renderText.replaceAll("[\\r\\n]+", " ⏎ "),
    };
  }

  private void sendStatus(
    CallbackContext callback,
    String id,
    String state,
    String message,
    int progress,
    boolean keep
  ) throws JSONException {
    JSONObject event = baseEvent(id, "status");
    event.put("state", state);
    event.put("message", message);
    event.put("progress", progress);
    send(callback, event, keep);
  }

  private void sendProgress(CallbackContext callback, String id, int progress)
    throws JSONException {
    JSONObject event = baseEvent(id, "progress");
    event.put("data", progress);
    send(callback, event, true);
  }

  private JSONObject baseEvent(String id, String type) throws JSONException {
    JSONObject event = new JSONObject();
    event.put("id", id);
    event.put("type", type);
    event.put("action", type);
    return event;
  }

  private void send(CallbackContext callback, JSONObject event, boolean keep) {
    PluginResult result = new PluginResult(PluginResult.Status.OK, event);
    result.setKeepCallback(keep);
    callback.sendPluginResult(result);
  }

  private void sendError(CallbackContext callback, String id, Exception error) {
    try {
      JSONObject event = baseEvent(id, "error");
      event.put("error", error.getMessage() == null ? error.toString() : error.getMessage());
      send(callback, event, false);
    } catch (JSONException jsonError) {
      callback.error(error.getMessage());
    }
  }

  private boolean isSupportedUrl(String url) {
    return url != null && (url.startsWith("file:") || url.startsWith("content:"));
  }

  private boolean isSafUrl(String url) {
    return url != null && url.startsWith("content:");
  }

  private Uri formatSafUri(String url) {
    SafUrl safUrl = parseSafUrl(url);
    return DocumentsContract.buildDocumentUriUsingTree(
      Uri.parse(safUrl.treeUrl),
      safUrl.docId
    );
  }

  private SafUrl parseSafUrl(String url) {
    if (url.contains(SEPARATOR)) {
      String[] parts = url.split(SEPARATOR, 2);
      return new SafUrl(parts[0], parts[1]);
    }
    Uri treeUri = Uri.parse(url);
    return new SafUrl(url, DocumentsContract.getTreeDocumentId(treeUri));
  }

  private File fileFromUrl(String url) {
    Uri uri = Uri.parse(url);
    return new File(uri.getPath());
  }

  private long safeLong(Cursor cursor, int index) {
    try {
      if (cursor.isNull(index)) return 0;
      return cursor.getLong(index);
    } catch (Exception ignored) {
      return 0;
    }
  }

  private long normalizeModified(JSONObject file) {
    long modified = file.optLong("modifiedDate", 0);
    if (modified == 0) modified = file.optLong("lastModified", 0);
    return modified;
  }

  private String joinPath(String parent, String name) {
    if (parent == null || parent.length() == 0) return name;
    if (name == null || name.length() == 0) return parent;
    if (parent.endsWith("/")) return parent + name;
    return parent + "/" + name;
  }

  private String basename(String url) {
    if (url == null || url.length() == 0) return "";
    int slash = url.lastIndexOf('/');
    return slash >= 0 ? url.substring(slash + 1) : url;
  }

  private String guessMime(String name) {
    if (name == null) return null;
    String lower = name.toLowerCase(Locale.ROOT);
    if (lower.endsWith(".js")) return "application/javascript";
    if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "application/typescript";
    if (lower.endsWith(".jsx")) return "application/javascript";
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
    if (lower.endsWith(".css")) return "text/css";
    if (lower.endsWith(".md")) return "text/markdown";
    if (lower.endsWith(".txt")) return "text/plain";
    if (lower.endsWith(".xml")) return "application/xml";
    return null;
  }

  private String normalizeMime(String name, String mime) {
    String guessed = guessMime(name);
    if (guessed != null && (mime == null || mime.length() == 0 || "application/octet-stream".equals(mime))) {
      return guessed;
    }
    return mime;
  }

  private static class Job {
    final String id;
    volatile boolean cancelled = false;

    Job(String id) {
      this.id = id;
    }
  }

  private static class ScanStats {
    int files = 0;
    int dirs = 0;
    int indexed = 0;
  }

  private static class SafUrl {
    final String treeUrl;
    final String docId;

    SafUrl(String treeUrl, String docId) {
      this.treeUrl = treeUrl;
      this.docId = docId;
    }
  }

  private static class FileEntry {
    final String rootUrl;
    final String parentUrl;
    final String url;
    final String name;
    final String path;
    final String mime;
    final boolean isDirectory;
    final long size;
    final long modifiedDate;

    FileEntry(
      String rootUrl,
      String parentUrl,
      String url,
      String name,
      String path,
      String mime,
      boolean isDirectory,
      long size,
      long modifiedDate
    ) {
      this.rootUrl = rootUrl;
      this.parentUrl = parentUrl;
      this.url = url;
      this.name = name == null ? "" : name;
      this.path = path == null ? this.name : path;
      this.mime = mime;
      this.isDirectory = isDirectory;
      this.size = Math.max(0, size);
      this.modifiedDate = Math.max(0, modifiedDate);
    }

    JSONObject toJSON() throws JSONException {
      JSONObject json = new JSONObject();
      json.put("rootUrl", rootUrl);
      json.put("parent", parentUrl);
      json.put("parentUrl", parentUrl);
      json.put("url", url);
      json.put("uri", url);
      json.put("name", name);
      json.put("path", path);
      json.put("mime", mime);
      json.put("type", mime);
      json.put("isDirectory", isDirectory);
      json.put("isFile", !isDirectory);
      json.put("size", size);
      json.put("modifiedDate", modifiedDate);
      return json;
    }

    static FileEntry fromJSON(JSONObject json) {
      return new FileEntry(
        json.optString("rootUrl", ""),
        json.optString("parentUrl", json.optString("parent", "")),
        json.optString("url", ""),
        json.optString("name", ""),
        json.optString("path", ""),
        json.optString("mime", json.optString("type", null)),
        json.optBoolean("isDirectory", false),
        json.optLong("size", 0),
        json.optLong("modifiedDate", json.optLong("lastModified", 0))
      );
    }

    boolean isBinary() {
      if (isDirectory) return false;
      String normalizedMime = mime == null ? "" : mime.toLowerCase(Locale.ROOT).split(";")[0].trim();
      if (normalizedMime.startsWith("text/") || TEXT_MIME_TYPES.contains(normalizedMime)) return false;
      if (isTextExtension(name)) return false;
      if (
        normalizedMime.startsWith("audio/") ||
        normalizedMime.startsWith("font/") ||
        normalizedMime.startsWith("image/") ||
        normalizedMime.startsWith("model/") ||
        normalizedMime.startsWith("video/") ||
        BINARY_MIME_TYPES.contains(normalizedMime)
      ) {
        return true;
      }

      String lowerName = name.toLowerCase(Locale.ROOT);
      int dot = lowerName.lastIndexOf('.');
      if (dot < 0) return false;
      String ext = lowerName.substring(dot + 1);
      if (BINARY_EXTENSIONS.contains(ext)) return true;
      int previousDot = lowerName.lastIndexOf('.', dot - 1);
      return previousDot >= 0 && BINARY_EXTENSIONS.contains(lowerName.substring(previousDot + 1));
    }

    private boolean isTextExtension(String filename) {
      String lowerName = filename == null ? "" : filename.toLowerCase(Locale.ROOT);
      int dot = lowerName.lastIndexOf('.');
      return dot >= 0 && TEXT_EXTENSIONS.contains(lowerName.substring(dot + 1));
    }
  }

  private static class DB extends SQLiteOpenHelper {
    DB(Context context) {
      super(context, "acode_workspace_index.db", null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
      db.execSQL(
        "CREATE TABLE IF NOT EXISTS workspaces (" +
        "root_url TEXT PRIMARY KEY, " +
        "title TEXT, " +
        "indexed_at INTEGER, " +
        "options_hash TEXT" +
        ")"
      );
      db.execSQL(
        "CREATE TABLE IF NOT EXISTS files (" +
        "url TEXT PRIMARY KEY, " +
        "root_url TEXT, " +
        "parent_url TEXT, " +
        "path TEXT, " +
        "name TEXT, " +
        "mime TEXT, " +
        "is_directory INTEGER, " +
        "size INTEGER, " +
        "modified_date INTEGER, " +
        "indexed_at INTEGER, " +
        "skipped_reason TEXT" +
        ")"
      );
      db.execSQL(
        "CREATE TABLE IF NOT EXISTS content (" +
        "url TEXT PRIMARY KEY, " +
        "size INTEGER, " +
        "modified_date INTEGER, " +
        "encoding TEXT, " +
        "text TEXT, " +
        "lower_text TEXT, " +
        "indexed_at INTEGER" +
        ")"
      );
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_files_root ON files(root_url)");
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_url)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
      db.execSQL("DROP TABLE IF EXISTS content");
      db.execSQL("DROP TABLE IF EXISTS files");
      db.execSQL("DROP TABLE IF EXISTS workspaces");
      onCreate(db);
    }
  }
}
