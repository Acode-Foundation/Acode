package com.foxdebug.sdcard;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.FileObserver;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;
import androidx.documentfile.provider.DocumentFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.apache.commons.io.FilenameUtils;
import org.apache.commons.io.IOUtils;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class SDcard extends CordovaPlugin {

  private int mode;
  private int SDK_INT = android.os.Build.VERSION.SDK_INT;
  private int REQUEST_CODE;
  private final int ACCESS_INTENT = 6000;
  private final int DOCUMENT_TREE = 6001;
  private final int OPEN_DOCUMENT = 6002;
  private final int PICK_FROM_GALLERY = 6003;
  private final String SEPARATOR = "::";
  private StorageManager storageManager;
  private Context context;
  private Activity activity;
  private ContentResolver contentResolver;
  private DocumentFile originalRootFile;
  private CallbackContext activityResultCallback;
  private HashMap<String, MyFileObserver> fileObservers = new HashMap();

  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    this.REQUEST_CODE = this.ACCESS_INTENT;
    this.context = cordova.getContext();
    this.activity = cordova.getActivity();
    this.storageManager = (StorageManager) this.activity.getSystemService(
        Context.STORAGE_SERVICE
      );
  }

  public boolean execute(
    String action,
    JSONArray args,
    CallbackContext callback
  ) throws JSONException {
    String arg1 = null, arg2 = null, arg3 = null, arg4 = null;
    int argLen = args.length();

    if (argLen > 0) arg1 = args.getString(0);

    if (argLen > 1) arg2 = args.getString(1);

    if (argLen > 2) arg3 = args.getString(2);

    switch (action) {
      case "create directory":
        createDir(arg1, arg2, callback);
        break;
      case "create file":
        createFile(arg1, arg2, callback);
        break;
      case "open document file":
        openDocumentFile(arg1, callback);
        break;
      case "get image":
        getImage(arg1, callback);
        break;
      case "list volumes":
        getStorageVolumes(callback);
        break;
      case "storage permission":
        getStorageAccess(arg1, callback);
        break;
      case "read":
        readFile(arg1, callback);
        break;
      case "write":
        writeFile(
          formatUri(arg1),
          args.optString(1),
          args.optBoolean(2),
          callback
        );
        break;
      case "rename":
        rename(arg1, arg2, callback);
        break;
      case "delete":
        delete(formatUri(arg1), callback);
        break;
      case "copy":
        copy(arg1, arg2, callback);
        break;
      case "move":
        move(arg1, arg2, callback);
        break;
      case "get path":
        getPath(formatUri(arg1), arg2, callback);
        break;
      case "exists":
        exists(formatUri(arg1), callback);
        break;
      case "format uri":
        callback.success(formatUri(arg1));
        break;
      case "list directory":
        if (arg1.contains(SEPARATOR)) {
          String splittedStr[] = arg1.split(SEPARATOR, 2);
          arg1 = splittedStr[0];
          arg2 = splittedStr[1];
        }

        listDir(arg1, arg2, callback);

        break;
      case "stats":
        getStats(arg1, callback);
        break;
      case "watch file":
        watchFile(arg1, arg2, callback);
        break;
      case "unwatch file":
        unwatchFile(arg1);
        break;
      default:
        return false;
    }

    return true;
  }

  private String formatUri(String filename) {
    if (filename.contains(SEPARATOR)) {
      String splittedStr[] = filename.split(SEPARATOR, 2);
      String rootUri = splittedStr[0];
      String docId = splittedStr[1];

      Uri uri = getUri(rootUri, docId);

      return uri.toString();
    } else {
      return filename;
    }
  }

  private void watchFile(
    final String fileUri,
    final String id,
    final CallbackContext listener
  ) {
    activity.runOnUiThread(
      new Runnable() {
        @Override
        public void run() {
          MyFileObserver observer;
          Uri uri = Uri.parse(fileUri);
          File file = new File(uri.getPath());

          if (!file.exists()) {
            listener.error("File not found");
            return;
          }

          if (SDK_INT >= 29) {
            observer = new MyFileObserver(file, listener);
          } else {
            observer = new MyFileObserver(fileUri, listener);
          }

          observer.startObserving();
          fileObservers.put(id, observer);
        }
      }
    );
  }

  private void unwatchFile(String id) {
    MyFileObserver observer = fileObservers.get(id);
    if (observer == null) return;
    observer.stopObserving();
    fileObservers.remove(id);
  }

  public void openDocumentFile(String mimeType, CallbackContext callback) {
    Intent intent = new Intent();
    if (mimeType == null) mimeType = "*/*";
    intent.setAction(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType(mimeType);
    activityResultCallback = callback;
    cordova.startActivityForResult(this, intent, this.OPEN_DOCUMENT);
  }

  public void getImage(String mimeType, CallbackContext callback) {
    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
    if (mimeType == null) mimeType = "image/*";

    intent.setType(mimeType);
    activityResultCallback = callback;
    cordova.startActivityForResult(this, intent, this.PICK_FROM_GALLERY);
  }

  public void getStorageVolumes(CallbackContext callback) {
    try {
      JSONArray result = new JSONArray();

      if (SDK_INT >= 24) {
        for (StorageVolume volume : this.storageManager.getStorageVolumes()) {
          String name = volume.getDescription(this.context);
          String uuid = volume.getUuid();
          JSONObject volumeData = new JSONObject();
          if (name != null && uuid != null) {
            volumeData.put("uuid", uuid);
            volumeData.put("name", name);

            if (SDK_INT >= 30) {
              File file = volume.getDirectory();
              String path = file.getAbsolutePath();
              volumeData.put("path", path);
            }

            result.put(volumeData);
          }
        }
      } else {
        File file = Environment.getExternalStorageDirectory();
        if (
          Environment.getExternalStorageState(file) == Environment.MEDIA_MOUNTED
        ) {
          String name = file.getName();
          String path = file.getPath();
          String absolutePath = file.getAbsolutePath();
          JSONObject volumeData = new JSONObject();
          volumeData.put("name", name);
          volumeData.put("path", path);
          volumeData.put("absolutePath", absolutePath);
          result.put(volumeData);
        }
      }

      callback.success(result);
    } catch (JSONException e) {
      callback.error(e.toString());
    }
  }

  public void getStorageAccess(String SDCardUUID, CallbackContext callback) {
    Intent intent = null;

    if (SDK_INT >= 24) {
      StorageVolume sdCard = null;

      for (StorageVolume volume : this.storageManager.getStorageVolumes()) {
        String uuid = volume.getUuid();
        if (uuid != null && uuid.equals(SDCardUUID)) {
          sdCard = volume;
        }
      }

      if (sdCard != null) {
        if (SDK_INT < 29) {
          intent = sdCard.createAccessIntent(null);
        } else if (SDK_INT >= 29) {
          intent = sdCard.createOpenDocumentTreeIntent();
        }
      }
    }

    if (intent == null) {
      REQUEST_CODE = DOCUMENT_TREE;
      intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    }

    activityResultCallback = callback;
    cordova.startActivityForResult(this, intent, REQUEST_CODE);
  }

  public void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);

    if (activityResultCallback == null) {
      Log.e("SDcard", "activityResultCallback is null");
      return;
    }

    if (data == null) return;

    if (resultCode == Activity.RESULT_CANCELED) {
      activityResultCallback.error("Operation cancelled");
      return;
    }

    if (requestCode == PICK_FROM_GALLERY) {
      if (resultCode == Activity.RESULT_OK) {
        Uri uri = data.getData();
        if (uri == null) {
          activityResultCallback.error("No file selected");
        } else {
          try {
            takePermission(uri);
            activityResultCallback.success(uri.toString());
          } catch (Exception e) {
            activityResultCallback.error(
              "Error taking permission: " + e.getMessage()
            );
          }
        }
        //activityResultCallback.success(uri.toString());
      } else {
        activityResultCallback.error("Operation cancelled");
      }
      return;
    }

    if (requestCode == OPEN_DOCUMENT) {
      if (resultCode == Activity.RESULT_OK) {
        try {
          Uri uri = data.getData();

          if (uri == null) {
            activityResultCallback.error("No file selected");
            return;
          }

          takePermission(uri);
          DocumentFile file = DocumentFile.fromSingleUri(context, uri);
          JSONObject res = new JSONObject();

          res.put("length", file.length());
          res.put("type", file.getType());
          res.put("filename", file.getName());
          res.put("canWrite", canWrite(file.getUri()));
          res.put("uri", uri.toString());
          activityResultCallback.success(res);
        } catch (JSONException e) {
          activityResultCallback.error(e.toString());
        }
      }

      return;
    }

    if (requestCode == DOCUMENT_TREE || requestCode == ACCESS_INTENT) {
      if (
        requestCode == ACCESS_INTENT && resultCode == Activity.RESULT_CANCELED
      ) {
        activityResultCallback.error("Canceled");
        return;
      }

      try {
        Uri uri = data.getData();
        if (uri == null) {
          activityResultCallback.error("Empty uri");
          return;
        }

        takePermission(uri);
        DocumentFile file = DocumentFile.fromTreeUri(context, uri);
        if (file != null && file.canWrite()) {
          activityResultCallback.success(uri.toString());
        } else {
          activityResultCallback.error(
            "No write permission: " + uri.toString()
          );
        }
      } catch (Exception error) {
        activityResultCallback.error(error.toString());
      }

      return;
    }
  }

  private void readFile(String filename, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              Uri uri = Uri.parse(filename);
              InputStream is = context
                .getContentResolver()
                .openInputStream(uri);

              if (is == null) {
                callback.error("File not found");
                return;
              }
              ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
              final int bufferSize = 1024;
              byte[] buffer = new byte[bufferSize];
              int bytesRead = 0;
              while ((bytesRead = is.read(buffer, 0, bufferSize)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
              }
              is.close();
              callback.success(outputStream.toByteArray());
            } catch (Exception e) {
              callback.error(e.toString());
            }
          }
        }
      );
  }

  private void writeFile(
    final String filename,
    final String content,
    final Boolean isArrayBuffer,
    final CallbackContext callback
  ) {
    final Context context = this.context;

    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              DocumentFile file = getFile(filename);
              if (file == null) {
                callback.error("File not fount.");
                return;
              }
              if (canWrite(file.getUri())) {
                OutputStream op = context
                  .getContentResolver()
                  .openOutputStream(file.getUri(), "rwt");

                PrintWriter pw = new PrintWriter(op, true);

                if (isArrayBuffer) {
                  byte[] bytes = Base64.decode(content, Base64.DEFAULT);
                  // write bytes to file
                  op.write(bytes);
                } else {
                  pw.print(content);
                }

                pw.flush();
                pw.close();
                op.close();
                callback.success("OK");
              } else {
                callback.error("No write permission");
              }
            } catch (Exception e) {
              callback.error(e.toString());
            }
          }
        }
      );
  }

  private void createDir(String parent, String name, CallbackContext callback) {
    create(parent, name, Document.MIME_TYPE_DIR, callback);
  }

  private void createFile(
    String parent,
    String name,
    CallbackContext callback
  ) {
    String mimeType = URLConnection.guessContentTypeFromName(name);
    String ext = FilenameUtils.getExtension(name);

    if (mimeType == null && ext != null) mimeType = "text/" + ext;
    else mimeType = "text/plain";

    create(parent, name, mimeType, callback);
  }

  private void create(
    String parent,
    String name,
    String mimeType,
    CallbackContext callback
  ) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String srcUri = null, docId = null;
              Uri parentUri = null;

              if (parent.contains(SEPARATOR)) {
                String splittedStr[] = parent.split(SEPARATOR, 2);
                srcUri = splittedStr[0];
                docId = splittedStr[1];
                parentUri = getUri(srcUri, docId);
              } else {
                srcUri = parent;
                parentUri = Uri.parse(srcUri);
                docId = DocumentsContract.getTreeDocumentId(parentUri);
                parentUri = DocumentsContract.buildDocumentUriUsingTree(
                  parentUri,
                  docId
                );
              }

              ContentResolver contentResolver = context.getContentResolver();
              Uri newDocumentUri = DocumentsContract.createDocument(
                contentResolver,
                parentUri,
                mimeType,
                name
              );
              DocumentFile file = DocumentFile.fromTreeUri(
                context,
                newDocumentUri
              );
              Log.i("SDcard", "Uri: " + newDocumentUri.toString());
              if (!name.equals(file.getName()) && file.renameTo(name)) {
                newDocumentUri = file.getUri();
              }

              docId = DocumentsContract.getDocumentId(newDocumentUri);
              if (newDocumentUri != null) {
                callback.success(srcUri + SEPARATOR + docId);
              } else {
                callback.error("Unable to create " + parent);
              }
            } catch (Exception e) {
              Log.e("CREATE_FILE", "Unable to create file", e);
              callback.error(e.toString());
            }
          }
        }
      );
  }

  private void rename(
    String filename,
    String newFile,
    CallbackContext callback
  ) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            String srcUri = null, docId = null;
            Uri fileUri = null;
            if (filename.contains(SEPARATOR)) {
              String splittedStr[] = filename.split(SEPARATOR, 2);
              srcUri = splittedStr[0];
              docId = splittedStr[1];
              fileUri = getUri(srcUri, docId);
            } else {
              srcUri = filename;
              fileUri = Uri.parse(filename);
            }

            try {
              DocumentFile file = DocumentFile.fromTreeUri(context, fileUri);
              // If only case change, OS adds '(<number>)' as suffix, to avoid that we need to rename to a temporary name first
              if (newFile.equalsIgnoreCase(file.getName())) {
                file.renameTo(newFile + "_temp");
              }

              if (file.renameTo(newFile)) {
                String name = file.getName();
                docId = DocumentsContract.getDocumentId(file.getUri());
                callback.success(srcUri + SEPARATOR + docId);
                return;
              }

              callback.error("Unable to rename: " + filename);
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  private void delete(String filename, CallbackContext callback) {
    final ContentResolver contentResolver = context.getContentResolver();

    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            Uri fileUri = Uri.parse(filename);

            try {
              boolean fileDeleted = DocumentsContract.deleteDocument(
                contentResolver,
                fileUri
              );

              if (fileDeleted) {
                callback.success(filename);
              } else {
                callback.error("Unable to delete file " + filename);
              }
            } catch (FileNotFoundException e) {
              callback.error(e.toString());
            }
          }
        }
      );
  }

  private void move(String src, String dest, final CallbackContext callback) {
    final ContentResolver contentResolver = this.context.getContentResolver();
    final String splittedStr[] = src.split(SEPARATOR, 2);
    final String rootUri = splittedStr[0];
    final String srcId = splittedStr[1];
    final String destId = dest.split(SEPARATOR, 2)[1];

    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          @Override
          public void run() {
            try {
              Uri newUri = copy(rootUri, srcId, destId);
              if (newUri == null) callback.error("Unable to copy " + src);
              else {
                DocumentsContract.deleteDocument(
                  contentResolver,
                  getUri(rootUri, srcId)
                );
                callback.success(
                  rootUri + SEPARATOR + DocumentsContract.getDocumentId(newUri)
                );
              }
            } catch (Exception e) {
              callback.error(e.toString());
            }
          }
        }
      );
  }

  private void copy(String src, String dest, final CallbackContext callback) {
    final String splittedStr[] = src.split(SEPARATOR, 2);
    final String srcUri = splittedStr[0];
    final String srcId = splittedStr[1];
    final String destId = dest.split(SEPARATOR, 2)[1];

    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          @Override
          public void run() {
            try {
              Uri newUri = copy(srcUri, srcId, destId);
              if (newUri == null) {
                callback.error("Unable to copy " + src);
              } else {
                callback.success(
                  srcUri + SEPARATOR + DocumentsContract.getDocumentId(newUri)
                );
              }
            } catch (Exception e) {
              callback.error(e.toString());
            }
          }
        }
      );
  }

  private Uri copy(String root, String srcId, String destId)
    throws IOException, FileNotFoundException {
    Uri srcUri = getUri(root, srcId);
    Uri destUri = getUri(root, destId);
    DocumentFile src = getFile(srcUri);
    DocumentFile dest = getFile(destUri);
    ContentResolver contentResolver = context.getContentResolver();

    if (src.isFile()) {
      Uri newUri = copyFile(src, dest);
      if (newUri == null) return null;
      else return newUri;
    } else {
      destUri = DocumentsContract.createDocument(
        contentResolver,
        destUri,
        Document.MIME_TYPE_DIR,
        src.getName()
      );
      destId = DocumentsContract.getDocumentId(destUri);

      Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
        Uri.parse(root),
        srcId
      );
      Cursor c = contentResolver.query(
        childrenUri,
        new String[] { Document.COLUMN_DOCUMENT_ID },
        null,
        null,
        null
      );
      if (c != null) {
        while (c.moveToNext()) {
          String docId = c.getString(0);
          copy(root, docId, destId);
        }
        c.close();
        return destUri;
      } else {
        DocumentsContract.deleteDocument(contentResolver, destUri);
        return null;
      }
    }
  }

  private Uri copyFile(DocumentFile src, DocumentFile dest)
    throws IOException, FileNotFoundException {
    ContentResolver contentResolver = this.context.getContentResolver();

    Uri newFileUri = DocumentsContract.createDocument(
      contentResolver,
      dest.getUri(),
      src.getType(),
      src.getName()
    );
    DocumentFile newFile = getFile(newFileUri);
    InputStream is = contentResolver.openInputStream(src.getUri());
    OutputStream os = contentResolver.openOutputStream(newFile.getUri(), "rwt");

    if (is == null || os == null) {
      DocumentsContract.deleteDocument(contentResolver, newFileUri);
      return null;
    }

    IOUtils.copy(is, os);

    is.close();
    os.close();

    if (src.length() == newFile.length()) return newFile.getUri();
    else {
      DocumentsContract.deleteDocument(contentResolver, newFileUri);
      return null;
    }
  }

  private void listDir(String src, String parentId, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            Uri srcUri = Uri.parse(src);
            ContentResolver contentResolver = context.getContentResolver();
            String parentDocId = parentId;

            if (parentDocId == null) {
              parentDocId = DocumentsContract.getTreeDocumentId(srcUri);
            }

            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
              srcUri,
              parentDocId
            );

            JSONArray result = new JSONArray();
            Cursor cursor = null;

            try {
              cursor = contentResolver.query(
                childrenUri,
                new String[] {
                  Document.COLUMN_DOCUMENT_ID,
                  Document.COLUMN_DISPLAY_NAME,
                  Document.COLUMN_MIME_TYPE,
                },
                null,
                null,
                null
              );
            } catch (
              NullPointerException
              | SecurityException
              | IllegalArgumentException
              | Error e
            ) {
              Log.d("sdCard", "lsDir: " + src);
              Log.e("sdCard", "lsDir", e);
              callback.error("Cannot read directory.");
              return;
            }

            if (cursor == null) {
              callback.error("Cannot read directory.");
              return;
            }

            try {
              while (cursor.moveToNext()) {
                JSONObject fileData = new JSONObject();
                String docId = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                boolean isDirectory = isDirectory(mime);

                fileData.put("name", name);
                fileData.put("mime", mime);
                fileData.put("isDirectory", isDirectory);
                fileData.put("isFile", !isDirectory);
                fileData.put("uri", src + SEPARATOR + docId); // TODO: Deprecate in future
                fileData.put("url", src + SEPARATOR + docId);
                result.put(fileData);
              }

              callback.success(result);
            } catch (JSONException e) {
              callback.error(e.toString());
            } finally {
              if (cursor != null) {
                try {
                  cursor.close();
                } catch (RuntimeException re) {
                  throw re;
                } catch (Exception ignore) {
                  // ignore exception
                }
              }
            }
          }
        }
      );
  }

  private boolean isDirectory(String mimeType) {
    return DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType);
  }

  private void getStats(String filename, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            String fileUri = formatUri(filename);

            try {
              DocumentFile file = getFile(fileUri);

              JSONObject result = new JSONObject();
              result.put("exists", file.exists());
              result.put("canRead", file.canRead());
              result.put("canWrite", canWrite(file.getUri()));
              result.put("name", file.getName());
              result.put("length", file.length());
              result.put("type", file.getType());
              result.put("isFile", file.isFile());
              result.put("isDirectory", file.isDirectory());
              result.put("isVirtual", file.isVirtual());
              result.put("lastModified", file.lastModified());
              result.put("url", file.getUri().toString());

              callback.success(result);
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  private Uri getUri(String src, String docId) {
    Uri srcUri = Uri.parse(src);
    String srcId = DocumentsContract.getTreeDocumentId(srcUri);
    srcUri = DocumentsContract.buildDocumentUriUsingTree(srcUri, srcId);
    return DocumentsContract.buildDocumentUriUsingTree(srcUri, docId);
  }

  private void exists(String path, CallbackContext callback) {
    DocumentFile file = DocumentFile.fromSingleUri(context, Uri.parse(path));

    if (file == null) {
      callback.error("Unable to get file");
    } else {
      if (file.exists()) {
        callback.success("TRUE");
      } else {
        callback.success("FALSE");
      }
    }
  }

  private void error(String err, CallbackContext callback) {
    callback.error("ERROR: " + err);
  }

  private void getPath(String uriString, String src, CallbackContext callback) {
    try {
      DocumentFile file = geRelativeDocumentFile(uriString, src);

      if (file == null) {
        callback.error("Unable to get file");
      } else {
        Uri uri = file.getUri();
        String path = uri.getPath();

        if (path != null) {
          callback.success(uri.toString());
        } else {
          callback.error("Unable to get path");
        }
      }
    } catch (Exception e) {
      callback.error(e.getMessage());
    }
  }

  private DocumentFile geRelativeDocumentFile(String uri, String filename) {
    List<String> paths = new ArrayList<String>();
    DocumentFile file = null;

    file = DocumentFile.fromTreeUri(context, Uri.parse(uri));
    if (!canWrite(file.getUri())) {
      throw new RuntimeException("Cannot write file");
    }

    paths.addAll(Arrays.asList(filename.split("/")));

    while (paths.size() > 0) {
      String path = paths.remove(0);
      filename = TextUtils.join("/", paths);

      if (!path.equals("")) {
        file = file.findFile(path);

        if (file == null) return null;
      }
    }

    return file;
  }

  private DocumentFile getFile(Uri uri) {
    return getFile(uri.toString());
  }

  private DocumentFile getFile(String filePath) {
    Uri fileUri = Uri.parse(filePath);
    DocumentFile documentFile = null;

    if (filePath.matches("file:///(.*)")) {
      File file = new File(fileUri.getPath());
      documentFile = DocumentFile.fromFile(file);
    } else {
      documentFile = DocumentFile.fromSingleUri(context, fileUri);
    }

    return documentFile;
  }

  private void takePermission(Uri uri) {
    contentResolver = context.getContentResolver();
    contentResolver.takePersistableUriPermission(
      uri,
      Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
      Intent.FLAG_GRANT_READ_URI_PERMISSION
    );
  }

  public boolean canWrite(Uri uri) {
    boolean canWrite = false;
    try {
      // if the file is not writable this throws a SecurityException
      OutputStream os = context
        .getContentResolver()
        .openOutputStream(uri, "wa");

      if (os == null) return false;

      os.close(); // we don't actually want to write anything, so we close immediately
      canWrite = true;
    } catch (
      SecurityException | IllegalArgumentException | IOException ignored
    ) {
      // if we don't have write-permission or the file doesn't exist, canWrite can stay on false
    }
    return canWrite;
  }
}

class MyFileObserver extends FileObserver {

  private CallbackContext listener;
  private static final int mask =
    (FileObserver.DELETE_SELF | FileObserver.MODIFY | FileObserver.MOVE_SELF);

  public MyFileObserver(String path, CallbackContext listener) {
    super(path, mask);
    this.listener = listener;
    Log.d("MyFileObserver", "MyFileObserver: " + path);
  }

  public MyFileObserver(File file, CallbackContext listener) {
    super(file, mask);
    this.listener = listener;
    Log.d("MyFileObserver", "MyFileObserver: " + file.getAbsolutePath());
  }

  @Override
  public void onEvent(int event, String path) {
    Log.d("MyFileObserver", "onEvent: " + event);
    PluginResult result = new PluginResult(PluginResult.Status.OK);
    result.setKeepCallback(true);
    listener.sendPluginResult(result);
  }

  public void startObserving() {
    startWatching();
  }

  public void stopObserving() {
    stopWatching();
  }
}
