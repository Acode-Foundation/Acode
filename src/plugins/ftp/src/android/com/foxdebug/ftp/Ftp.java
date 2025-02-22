package com.foxdebug.ftp;

import android.app.Activity;
import android.content.Context;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.UnsupportedEncodingException;
import java.lang.SecurityException;
import java.lang.reflect.Method;
import java.net.SocketException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import org.apache.commons.net.ftp.*;
import org.apache.commons.net.ftp.parser.ParserInitializationException;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class Ftp extends CordovaPlugin {

  HashMap<String, FTPClient> ftpProfiles = new HashMap<String, FTPClient>();
  Context context;
  Activity activity;
  String connectionID;

  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    context = cordova.getContext();
    activity = cordova.getActivity();
  }

  public boolean execute(
    String action,
    JSONArray args,
    CallbackContext callback
  ) {
    try {
      Method method =
        this.getClass()
          .getDeclaredMethod(action, JSONArray.class, CallbackContext.class);
      if (method != null) {
        method.invoke(this, args, callback);
        return true;
      }
      return false;
    } catch (NoSuchMethodException e) {
      callback.error(e.getMessage());
      return false;
    } catch (SecurityException e) {
      callback.error(e.getMessage());
      return false;
    } catch (Exception e) {
      callback.error(e.getMessage());
      return false;
    }
  }

  public void connect(JSONArray args, CallbackContext callback) {
    connect(args, callback, false);
  }

  public void connect(
    JSONArray args,
    CallbackContext callback,
    boolean isRetry
  ) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            int reply;
            int port = args.optInt(1);
            String host = args.optString(0);
            String username = args.optString(2);
            String password = args.optString(3);
            String defaultPath = args.optString(4);
            String securityType = args.optString(5);
            String connectionMode = args.optString(6);
            String encryption = args.optString(7);
            String encoding = args.optString(8);
            String ftpId = getFtpId(host, port, username);
            FTPClient ftp = null;

            try {
              if (ftpProfiles.containsKey(ftpId)) {
                ftp = ftpProfiles.get(ftpId);
                reply = ftp.getReplyCode();
                if (ftp.isConnected() && FTPReply.isPositiveCompletion(reply)) {
                  ftp.setControlEncoding("UTF-8");
                  ftp.setAutodetectUTF8(true);
                  System.setProperty("ftp.client.encoding", "UTF-8");
                  // test if connection is still valid
                  ftp.sendNoOp();
                  Log.d("FTP", "FTPClient (" + ftpId + ") is connected");
                  callback.success(ftpId);
                  return;
                }
                Log.d("FTP", "FTPClient (" + ftpId + ") is not connected");
                ftp.disconnect();
                Log.d("FTP", "FTPClient (" + ftpId + ") disconnecting...");
              } else {
                Log.d("FTP", "Creating new FTPClient (" + ftpId + ")");
                ftp = new FTPClient();
                ftpProfiles.put(ftpId, ftp);
              }

              Log.d("FTP", "FTPClient (" + ftpId + ") connecting...");
              ftp.connect(host, port);
              ftp.setControlKeepAliveTimeout(300);
              if (connectionMode.equals("active")) {
                Log.d("FTP", "Entering Local Active mode");
                ftp.enterLocalActiveMode();
              } else {
                Log.d("FTP", "Entering Passive Active mode");
                ftp.enterLocalPassiveMode();
              }

              Log.d("FTP", "FTPClient (" + ftpId + ") logging in...");
              ftp.login(username, password);

              reply = ftp.getReplyCode();
              if (!FTPReply.isPositiveCompletion(reply)) {
                ftp.disconnect();
                Log.d(
                  "FTP",
                  "FTPClient (" + ftpId + ") server refused connection."
                );
                callback.error("FTP server refused connection.");
                return;
              }

              ftp.setListHiddenFiles(true);
              ftpProfiles.put(ftpId, ftp);
              Log.d("FTP", "FTPClient (" + ftpId + ") connected");
              callback.success(ftpId);
            } catch (IOException e) {
              Log.e("FTP", "FTPClient (" + ftpId + ")", e);
              if (ftp != null) {
                ftpProfiles.remove(ftpId);
              }

              if (!isRetry) {
                connect(args, callback, true);
                return;
              }

              callback.error(e.getMessage());
            } catch (Exception e) {
              Log.e("FTP", "FTPClient (" + ftpId + ")", e);

              if (ftp != null) {
                ftpProfiles.remove(ftpId);
              }

              if (!isRetry) {
                connect(args, callback, true);
                return;
              }

              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  private static String getBaseName(String path) {
    int lastSepIndex = path.lastIndexOf('/');
    if (lastSepIndex == path.length() - 1) {
      return getBaseName(path.substring(0, lastSepIndex));
    }

    return path.substring(lastSepIndex + 1);
  }

  private static String getParentPath(String path) {
    int lastSepIndex = path.lastIndexOf('/');
    if (lastSepIndex == path.length() - 1) {
      lastSepIndex = path.substring(0, lastSepIndex).lastIndexOf('/');
    }

    return path.substring(0, lastSepIndex);
  }

  public void listDirectory(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String path = args.optString(1);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (path == null || path.isEmpty()) {
                path = "/";
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              FTPFile[] files = ftp.listFiles(path);
              Log.d(
                "FTP",
                "FTPClient (" + ftpId + ") Listing files in " + path
              );
              Log.d(
                "FTP",
                "FTPClient (" + ftpId + ") Found " + files.length + " files."
              );

              JSONArray jsonFiles = new JSONArray();

              for (FTPFile file : files) {
                String filename = file.getName();
                if (filename.equals(".") || filename.equals("..")) {
                  continue;
                }

                JSONObject jsonFile = new JSONObject();
                jsonFile.put("name", filename);
                jsonFile.put("length", file.getSize());
                jsonFile.put("url", joinPath(path, filename));

                if (file.isSymbolicLink()) {
                  jsonFile.put("isLink", true);
                  String linkTarget = file.getLink();
                  jsonFile.put("link", linkTarget);
                  String linkPath = linkTarget.startsWith("/")
                    ? linkTarget
                    : joinPath(path, linkTarget);
                  try {
                    FTPFile[] targetFiles = ftp.listFiles(linkPath);
                    if (targetFiles.length > 0) {
                      FTPFile targetFile = targetFiles[0];
                      jsonFile.put("isFile", targetFile.isFile());
                      jsonFile.put("isDirectory", targetFile.isDirectory());
                      jsonFile.put("url", linkPath);
                    } else {
                      jsonFile.put("isFile", false);
                      jsonFile.put("isDirectory", false);
                    }
                  } catch (Exception e) {
                    // Handle broken symlink
                    jsonFile.put("isFile", false);
                    jsonFile.put("isDirectory", false);
                  }
                } else {
                  jsonFile.put("isLink", false);
                  jsonFile.put("isDirectory", file.isDirectory());
                  jsonFile.put("isFile", file.isFile());
                  jsonFile.put("link", null);
                }

                jsonFile.put(
                  "lastModified",
                  file.getTimestamp().getTimeInMillis()
                );
                jsonFile.put(
                  "canWrite",
                  file.hasPermission(
                    FTPFile.USER_ACCESS,
                    FTPFile.WRITE_PERMISSION
                  )
                );
                jsonFile.put(
                  "canRead",
                  file.hasPermission(
                    FTPFile.USER_ACCESS,
                    FTPFile.READ_PERMISSION
                  )
                );
                jsonFiles.put(jsonFile);
              }
              callback.success(jsonFiles);
            } catch (ParserInitializationException e) {
              callback.error(e.getMessage());
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void exists(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            String ftpId = args.optString(0);
            String path = args.optString(1);
            try {
              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (path == null || path.isEmpty()) {
                path = "/";
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              // check if file or directory exists
              FTPFile[] ftpFiles = ftp.listFiles(path);
              if (ftpFiles.length > 0) {
                callback.success(1);
              } else {
                callback.success(0);
              }
            } catch (ParserInitializationException e) {
              Log.e("FTP", "FTPClient (" + ftpId + ") path: " + path, e);
              callback.error(e.getMessage());
              Log.e("FTP", "FTPClient (" + ftpId + ") path: " + path, e);
            } catch (FTPConnectionClosedException e) {
              Log.e("FTP", "FTPClient (" + ftpId + ") path: " + path, e);
              callback.error(e.getMessage());
            } catch (IOException e) {
              Log.e("FTP", "FTPClient (" + ftpId + ") path: " + path, e);
              callback.error(e.getMessage());
            } catch (Exception e) {
              Log.e("FTP", "FTPClient (" + ftpId + ") path: " + path, e);
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void sendNoOp(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }
              ftp.sendNoOp();
              callback.success();
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void deleteFile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String path = args.optString(1);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (path == null || path.isEmpty()) {
                callback.error("Path is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              ftp.deleteFile(path);
              callback.success();
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void deleteDirectory(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String path = args.optString(1);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (path == null || path.isEmpty()) {
                callback.error("Path is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              Log.d("FTP", "Deleting directory " + path);
              // delete all files in the directory
              emptyDirectory(path, ftp);

              callback.success();
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void rename(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String oldPath = args.optString(1);
              String newPath = args.optString(2);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (oldPath == null || oldPath.isEmpty()) {
                callback.error("Old path is required.");
                return;
              }

              if (newPath == null || newPath.isEmpty()) {
                callback.error("New path is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);

              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              // get list of files in the parent directory
              String parentPath = getParentPath(oldPath);
              FTPFile[] ftpFiles = ftp.listFiles(parentPath);

              Log.d("FTP", "Renaming " + oldPath + " to " + newPath);
              ftp.rename(oldPath, newPath);

              // check if file is renamed successfully
              FTPFile[] newFile = ftp.listFiles(newPath);
              if (newFile.length > 0) {
                callback.success(newPath);
              } else {
                // get latest list of files in the parent directory
                FTPFile[] latestFtpFiles = ftp.listFiles(parentPath);
                // some time src file is renamed and not moved to destination
                // check if for changed file and rename it original name
                FTPFile changedFile = null;
                for (FTPFile file : latestFtpFiles) {
                  boolean found = false;
                  for (FTPFile oldFile : ftpFiles) {
                    if (oldFile.getName().equals(file.getName())) {
                      found = true;
                      break;
                    }
                  }
                  if (!found) {
                    changedFile = file;
                    break;
                  }
                }

                if (changedFile != null) {
                  String changedFilePath = joinPath(
                    parentPath,
                    changedFile.getName()
                  );
                  ftp.rename(changedFilePath, oldPath);
                }
                callback.error("Failed to rename file");
              }

              callback.success();
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void downloadFile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String path = args.optString(1);
              String localFilePath = args.optString(2);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (path == null || path.isEmpty()) {
                callback.error("Path is required.");
                return;
              }

              if (localFilePath == null || localFilePath.isEmpty()) {
                callback.error("Local file is required.");
                return;
              }

              URI uri = new URI(localFilePath);
              File localFile = new File(uri);
              FTPClient ftp = ftpProfiles.get(ftpId);

              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              ftp.setFileType(FTP.BINARY_FILE_TYPE);

              InputStream inputStream = ftp.retrieveFileStream(path);
              if (inputStream == null) {
                Log.d(
                  "FTP",
                  "FTPClient (" + ftpId + ") path: " + path + " - not found"
                );
                callback.error("File not found.");
                return;
              }

              FileOutputStream outputStream = new FileOutputStream(localFile);
              byte[] buffer = new byte[1024];
              int bytesRead = -1;
              while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
              }
              outputStream.close();
              inputStream.close();

              if (!ftp.completePendingCommand()) {
                ftp.logout();
                ftp.disconnect();
                callback.error("File transfer failed.");
                return;
              }

              callback.success();
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (URISyntaxException e) {
              callback.error(e.getMessage());
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void uploadFile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String localFilePath = args.optString(1);
              String remoteFilePath = args.optString(2);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (remoteFilePath == null || remoteFilePath.isEmpty()) {
                callback.error("Path is required.");
                return;
              }

              if (localFilePath == null || localFilePath.isEmpty()) {
                callback.error("Local file is required.");
                return;
              }

              Log.d("FTPUpload", "uploadFile: " + localFilePath);
              URI uri = new URI(localFilePath);
              File localFile = new File(uri);
              FTPClient ftp = ftpProfiles.get(ftpId);

              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              ftp.setFileType(FTP.BINARY_FILE_TYPE);

              Log.d("FTPUpload", "Destination " + remoteFilePath);
              OutputStream outputStream = ftp.storeFileStream(remoteFilePath);
              if (outputStream == null) {
                callback.error("File not found.");
                return;
              }

              InputStream inputStream = new FileInputStream(localFile);
              byte[] buffer = new byte[1024];
              int bytesRead = -1;
              while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
              }
              outputStream.close();
              inputStream.close();

              if (!ftp.completePendingCommand()) {
                ftp.logout();
                ftp.disconnect();
                callback.error("File transfer failed.");
                return;
              }

              callback.success();
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (URISyntaxException e) {
              callback.error(e.getMessage());
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void getKeepAlive(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              callback.success((int) ftp.getControlKeepAliveTimeout());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void execCommand(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String command = args.optString(1);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (command == null || command.isEmpty()) {
                callback.error("Command is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              ftp.sendCommand(command);
              String reply = ftp.getReplyString();
              callback.success(reply);
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void isConnected(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              boolean connected = ftp.isConnected();
              callback.success(connected ? 1 : 0);
            } catch (Exception e) {
              Log.e("FTP", "FTPClient", e);
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void disconnect(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp != null) {
                ftp.disconnect();
                ftpProfiles.remove(ftpId);
              }
              callback.success();
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void createDirectory(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String path = args.optString(1);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (path == null || path.isEmpty()) {
                callback.error("Path is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              ftp.makeDirectory(path);
              callback.success();
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void changeDirectory(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String path = args.optString(1);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (path == null || path.isEmpty()) {
                callback.error("Path is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              ftp.changeWorkingDirectory(path);
              callback.success();
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void changeToParentDirectory(
    JSONArray args,
    CallbackContext callback
  ) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              ftp.changeToParentDirectory();
              callback.success();
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void getWorkingDirectory(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              String workingDirectory = ftp.printWorkingDirectory();
              callback.success(workingDirectory);
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  public void getStat(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String ftpId = args.optString(0);
              String path = args.optString(1);

              if (ftpId == null || ftpId.isEmpty()) {
                callback.error("FTP ID is required.");
                return;
              }

              if (path == null || path.isEmpty()) {
                callback.error("Path is required.");
                return;
              }

              FTPClient ftp = ftpProfiles.get(ftpId);
              if (ftp == null) {
                callback.error("FTP client not found.");
                return;
              }

              FTPFile[] files = ftp.listFiles(path);
              if (files == null || files.length == 0) {
                callback.error("File not found.");
                return;
              }

              FTPFile file = files[0];
              JSONObject stat = new JSONObject();
              stat.put("isFile", file.isFile());
              stat.put("isValid", file.isValid());
              stat.put("isUnknown", file.isUnknown());
              stat.put("isDirectory", file.isDirectory());
              stat.put("isLink", file.isSymbolicLink());
              stat.put("linkCount", file.getHardLinkCount());
              stat.put("length", file.getSize());
              stat.put("name", getBaseName(file.getName()));
              stat.put("lastModified", file.getTimestamp().getTimeInMillis());
              stat.put("link", file.getLink());
              stat.put("group", file.getGroup());
              stat.put("user", file.getUser());
              stat.put(
                "canWrite",
                file.hasPermission(
                  FTPFile.USER_ACCESS,
                  FTPFile.WRITE_PERMISSION
                )
              );
              stat.put(
                "canRead",
                file.hasPermission(FTPFile.USER_ACCESS, FTPFile.READ_PERMISSION)
              );

              callback.success(stat);
            } catch (ParserInitializationException e) {
              callback.error(e.getMessage());
            } catch (FTPConnectionClosedException e) {
              callback.error(e.getMessage());
            } catch (IOException e) {
              callback.error(e.getMessage());
            } catch (Exception e) {
              callback.error(e.getMessage());
            }
          }
        }
      );
  }

  private String getFtpId(String host, int port, String username) {
    return username + "@" + host + ":" + port;
  }

  private String errMessage(Exception e) {
    String res = e.getMessage();
    if (res == null || res.equals("")) {
      return e.toString();
    }

    return res;
  }

  private void emptyDirectory(String directory, FTPClient client)
    throws FTPConnectionClosedException, IOException {
    FTPFile[] files = client.listFiles(directory);
    for (FTPFile file : files) {
      String filename = file.getName();
      if (filename.equals(".") || filename.equals("..")) {
        continue;
      }
      if (file.isDirectory()) {
        Log.d("FTP", "Removing directory: " + file.getName());
        emptyDirectory(directory + "/" + file.getName(), client);
      } else {
        Log.d("FTP", "Removing file: " + file.getName());
        client.deleteFile(directory + "/" + file.getName());
      }
    }
    client.removeDirectory(directory);
  }

  private String joinPath(String p1, String p2) {
    if (!p1.endsWith("/")) {
      p1 += "/";
    }
    return p1 + p2;
  }
}
