package com.foxdebug.sftp;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import android.util.Log;
import androidx.documentfile.provider.DocumentFile;
import com.sshtools.client.SshClient;
import com.sshtools.client.SshClient.SshClientBuilder;
import com.sshtools.client.sftp.SftpClient;
import com.sshtools.client.sftp.SftpClient.SftpClientBuilder;
import com.sshtools.client.sftp.SftpFile;
import com.sshtools.client.sftp.TransferCancelledException;
import com.sshtools.common.permissions.PermissionDeniedException;
import com.sshtools.common.publickey.InvalidPassphraseException;
import com.sshtools.common.publickey.SshKeyUtils;
import com.sshtools.common.sftp.SftpFileAttributes;
import com.sshtools.common.sftp.SftpStatusException;
import com.sshtools.common.ssh.SshException;
import com.sshtools.common.ssh.components.SshKeyPair;
import com.sshtools.common.ssh.components.jce.JCEProvider;
import com.sshtools.common.util.FileUtils;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.lang.SecurityException;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.channels.UnresolvedAddressException;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Arrays;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

public class Sftp extends CordovaPlugin {

  private static final String TAG = "SFTP";
  private SshClient ssh;
  private SftpClient sftp;
  private Context context;
  private Activity activity;
  private String connectionID;

  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    context = cordova.getContext();
    activity = cordova.getActivity();
    System.setProperty("maverick.log.nothread", "true");
  }

  public boolean execute(
    String action,
    JSONArray args,
    CallbackContext callback
  ) {
    try {
      Method method = getClass()
        .getDeclaredMethod(action, JSONArray.class, CallbackContext.class);

      if (method != null) {
        method.invoke(this, args, callback);
        return true;
      }
    } catch (NoSuchMethodException e) {
      callback.error("Method not found: " + action);
      return false;
    } catch (SecurityException e) {
      callback.error("Security exception: " + e.getMessage());
      return false;
    } catch (Exception e) {
      callback.error("Exception: " + e.getMessage());
      return false;
    }

    return false;
  }

  public void connectUsingPassword(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String host = args.optString(0);
              int port = args.optInt(1);
              String username = args.optString(2);
              String password = args.optString(3);
              JCEProvider.enableBouncyCastle(true);
              Log.d(
                TAG,
                "Connecting to " + host + ":" + port + " as " + username
              );
              ssh = SshClientBuilder.create()
                .withHostname(host)
                .withPort(port)
                .withUsername(username)
                .withPassword(password)
                .build();

              if (ssh.isConnected()) {
                connectionID = username + "@" + host;

                try {
                  sftp = SftpClientBuilder.create().withClient(ssh).build();
                } catch (IOException | SshException e) {
                  ssh.close();
                  callback.error(
                    "Failed to initialize SFTP subsystem: " + errMessage(e)
                  );
                  Log.e(TAG, "Failed to initialize SFTP subsystem", e);
                  return;
                }

                try {
                  sftp.getSubsystemChannel().setCharsetEncoding("UTF-8");
                } catch (UnsupportedEncodingException | SshException e) {
                  // Fallback to default encoding if UTF-8 fails
                  Log.w(
                    TAG,
                    "Failed to set UTF-8 encoding, falling back to default",
                    e
                  );
                }
                callback.success();
                Log.d(TAG, "Connected successfully to " + connectionID);
                return;
              }

              callback.error("Failed to establish SSH connection");
            } catch (UnresolvedAddressException e) {
              callback.error("Cannot resolve host address");
              Log.e(TAG, "Cannot resolve host address", e);
            } catch (PermissionDeniedException e) {
              callback.error("Authentication failed: " + e.getMessage());
              Log.e(TAG, "Authentication failed", e);
            } catch (SshException e) {
              callback.error("SSH error: " + errMessage(e));
              Log.e(TAG, "SSH error", e);
            } catch (IOException e) {
              callback.error("I/O error: " + errMessage(e));
              Log.e(TAG, "I/O error", e);
            } catch (Exception e) {
              callback.error("Unexpected error: " + errMessage(e));
              Log.e(TAG, "Unexpected error", e);
            }
          }
        }
      );
  }

  public void connectUsingKeyFile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String host = args.optString(0);
              int port = args.optInt(1);
              String username = args.optString(2);
              String keyFile = args.optString(3);
              String passphrase = args.optString(4);
              DocumentFile file = DocumentFile.fromSingleUri(
                context,
                Uri.parse(keyFile)
              );
              Uri uri = file.getUri();
              ContentResolver contentResolver = context.getContentResolver();
              InputStream in = contentResolver.openInputStream(uri);

//            for `appDataDirectory`, Ref: https://developer.android.com/reference/android/content/Context#getExternalFilesDir(java.lang.String)
//            the absolute path to application-specific directory. May return *null* if shared storage is not currently available.
              File appDataDirectory = context.getExternalFilesDir(null);
              if (appDataDirectory != null) {
                com.sshtools.common.logger.Log.getDefaultContext().enableFile(com.sshtools.common.logger.Log.Level.DEBUG, new File(appDataDirectory,"synergy.log"));
              }
//            JCEProvider.enableBouncyCastle(false);

              Log.i(TAG, "All Available Security Providers (Security.getProviders() : " + Arrays.toString(Security.getProviders()));
              Log.i(TAG, "All Available Security Providers for ED25519 (Security.getProviders(\"KeyPairGenerator.Ed25519\"\") : " + Arrays.toString(Security.getProviders("KeyPairGenerator.Ed25519")));
              Log.i(TAG, "BC Security Provider Name (`Security.getProvider(BouncyCastleProvider.PROVIDER_NAME)`) : " + Security.getProvider(BouncyCastleProvider.PROVIDER_NAME));
              Security.removeProvider("BC");
              Security.insertProviderAt(new BouncyCastleProvider(), 1);

              Log.i(TAG, "(After Inserting BC) All Available Security Providers (Security.getProviders() : " + Arrays.toString(Security.getProviders()));
              Log.i(TAG, "(After Inserting BC) All Available Security Providers for ED25519 (Security.getProviders(\"KeyPairGenerator.Ed25519\"\") : " + Arrays.toString(Security.getProviders("KeyPairGenerator.Ed25519")));
              Log.i(TAG, "(After Inserting BC) BC Security Provider Name (`Security.getProvider(BouncyCastleProvider.PROVIDER_NAME)`) : " + Security.getProvider(BouncyCastleProvider.PROVIDER_NAME));

              SshKeyPair keyPair = null;
              try {
                keyPair = SshKeyUtils.getPrivateKey(in, passphrase);
              } catch (InvalidPassphraseException e) {
                callback.error("Invalid passphrase for key file");
                Log.e(TAG, "Invalid passphrase for key file", e);
                return;
              } catch (IOException e) {
                callback.error("Could not read key file: " + errMessage(e));
                Log.e(TAG, "Could not read key file", e);
                return;
              }

              ssh = SshClientBuilder.create()
                .withHostname(host)
                .withPort(port)
                .withUsername(username)
                .withIdentities(keyPair)
                .build();

              if (ssh.isConnected()) {
                connectionID = username + "@" + host;
                try {
                  sftp = SftpClientBuilder.create().withClient(ssh).build();
                } catch (IOException | SshException e) {
                  ssh.close();
                  callback.error(
                    "Failed to initialize SFTP subsystem: " + errMessage(e)
                  );
                  Log.e(TAG, "Failed to initialize SFTP subsystem", e);
                  return;
                }

                try {
                  sftp.getSubsystemChannel().setCharsetEncoding("UTF-8");
                } catch (UnsupportedEncodingException | SshException e) {
                  // Fallback to default encoding if UTF-8 fails
                  Log.w(
                    TAG,
                    "Failed to set UTF-8 encoding, falling back to default",
                    e
                  );
                }
                callback.success();
                Log.d(TAG, "Connected successfully to " + connectionID);
                return;
              }

              callback.error("Failed to establish SSH connection");
            } catch (UnresolvedAddressException e) {
              callback.error("Cannot resolve host address");
              Log.e(TAG, "Cannot resolve host address", e);
            } catch (PermissionDeniedException e) {
              callback.error("Authentication failed: " + e.getMessage());
              Log.e(TAG, "Authentication failed", e);
            } catch (SshException e) {
              callback.error("SSH error: " + errMessage(e));
              Log.e(TAG, "SSH error", e);
            } catch (IOException e) {
              callback.error("I/O error: " + errMessage(e));
              Log.e(TAG, "I/O error", e);
            } catch (SecurityException e) {
              callback.error("Security error: " + errMessage(e));
              Log.e(TAG, "Security error", e);
            } catch (Exception e) {
              callback.error("Unexpected error: " + errMessage(e));
              Log.e(TAG, "Unexpected error", e);
            }
          }
        }
      );
  }

  public void exec(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String command = args.optString(0);
              if (ssh != null) {
                JSONObject res = new JSONObject();
                StringBuffer buffer = new StringBuffer();
                int code = ssh.executeCommandWithResult(command, buffer);
                String result = buffer.toString();
                res.put("code", code);
                res.put("result", result);
                callback.success(res);
                return;
              }
              callback.error("Not connected");
            } catch (IOException | JSONException e) {
              callback.error(errMessage(e));
            }
          }
        }
      );
  }

  public void getFile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String filename = args.optString(0);
              String localFilename = args.optString(1);
              if (ssh != null && sftp != null) {
                URI uri = new URI(localFilename);
                DocumentFile file = DocumentFile.fromSingleUri(
                  context,
                  Uri.parse(localFilename)
                );
                Uri fileUri = file.getUri();
                ContentResolver contentResolver = context.getContentResolver();

                try (
                  InputStream inputStream = sftp.getInputStream(filename);
                  java.io.OutputStream outputStream =
                    contentResolver.openOutputStream(fileUri)
                ) {
                  byte[] buffer = new byte[32768];
                  int bytesRead;

                  while ((bytesRead = inputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, bytesRead);
                  }

                  outputStream.flush();
                  callback.success();
                  return;
                } catch (SftpStatusException e) {
                  callback.error("SFTP transfer error: " + errMessage(e));
                  return;
                }
              }
              Log.d("getFile", "ssh or sftp is null");
              callback.error("Not connected");
            } catch (
              IOException
              | URISyntaxException
              | SecurityException
              | SshException e
            ) {
              Log.e("getFile", "Error downloading file", e);
              callback.error("File transfer error: " + errMessage(e));
            }
          }
        }
      );
  }

  public void putFile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String remoteFilename = args.optString(0);
              String localFilename = args.optString(1);

              if (ssh == null || sftp == null) {
                callback.error("Not connected");
                return;
              }

              if (remoteFilename == null || remoteFilename.isEmpty()) {
                callback.error("Remote filename is required");
                return;
              }

              if (localFilename == null || localFilename.isEmpty()) {
                callback.error("Local filename is required");
                return;
              }

              File localFile;
              try {
                URI uri = new URI(localFilename);
                localFile = new File(uri);
              } catch (URISyntaxException e) {
                callback.error("Invalid local URI: " + errMessage(e));
                return;
              }

              if (!localFile.exists() || !localFile.canRead()) {
                callback.error("Local file does not exist or is not readable");
                return;
              }

              try {
                sftp.put(localFile.getAbsolutePath(), remoteFilename);
                callback.success("File uploaded successfully");
              } catch (IOException e) {
                callback.error("Error uploading file: " + errMessage(e));
              }
            } catch (Exception e) {
              callback.error(errMessage(e));
            }
          }
        }
      );
  }

  public void lsDir(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String path = args.optString(0);
              if (ssh != null && sftp != null) {
                JSONArray files = new JSONArray();
                for (SftpFile file : sftp.ls(path)) {
                  String filename = file.getFilename();
                  if (filename.equals(".") || filename.equals("..")) {
                    continue;
                  }
                  SftpFileAttributes fileAttributes = file.attributes();
                  JSONObject fileInfo = new JSONObject();
                  fileInfo.put("name", filename);
                  fileInfo.put("exists", true);

                  if (fileAttributes != null) {
                    String permissions = fileAttributes.toPermissionsString();
                    boolean canRead = permissions.charAt(1) == 'r';
                    boolean canWrite = permissions.charAt(2) == 'w';
                    fileInfo.put("canRead", canRead);
                    fileInfo.put("canWrite", canWrite);
                    fileInfo.put("permissions", permissions);
                    fileInfo.put("length", fileAttributes.size());
                    fileInfo.put("url", file.getAbsolutePath());
                    fileInfo.put(
                      "lastModified",
                      fileAttributes.lastModifiedTime()
                    );

                    if (permissions.charAt(0) == 'l') {
                      fileInfo.put("isLink", true);
                      try {
                        String linkTarget = sftp.getSymbolicLinkTarget(
                          file.getAbsolutePath()
                        );
                        fileInfo.put("linkTarget", linkTarget);
                        SftpFileAttributes linkAttributes = sftp.stat(
                          linkTarget
                        );
                        fileInfo.put("isFile", linkAttributes.isFile());
                        fileInfo.put(
                          "isDirectory",
                          linkAttributes.isDirectory()
                        );
                      } catch (SftpStatusException | SshException e) {
                        // Handle broken symlink
                        fileInfo.put("isFile", false);
                        fileInfo.put("isDirectory", false);
                        fileInfo.put("isLink", false);
                      }
                    } else {
                      fileInfo.put("isLink", false);
                      fileInfo.put("isDirectory", fileAttributes.isDirectory());
                      fileInfo.put("isFile", fileAttributes.isFile());
                    }
                  }

                  files.put(fileInfo);
                }
                callback.success(files);
                return;
              }
              callback.error("Not connected");
            } catch (SftpStatusException | JSONException | SshException e) {
              callback.error(errMessage(e));
            }
          }
        }
      );
  }

  public void stat(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String path = sanitizePath(args.optString(0));
              if (ssh != null && sftp != null) {
                URI uri = new URI(path);
                JSONObject fileStat = new JSONObject();

                try {
                  SftpFileAttributes fileAttributes = sftp.stat(uri.getPath());
                  if (fileAttributes != null) {
                    String permissions = fileAttributes.toPermissionsString();
                    boolean canRead = permissions.charAt(1) == 'r';
                    boolean canWrite = permissions.charAt(2) == 'w';

                    fileStat.put("exists", true);
                    fileStat.put("canRead", canRead);
                    fileStat.put("canWrite", canWrite);
                    fileStat.put("isLink", fileAttributes.isLink());
                    fileStat.put("isDirectory", fileAttributes.isDirectory());
                    fileStat.put("isFile", fileAttributes.isFile());
                    fileStat.put("length", fileAttributes.size());
                    fileStat.put(
                      "permissions",
                      fileAttributes.toPermissionsString()
                    );
                    fileStat.put(
                      "lastModified",
                      fileAttributes.lastModifiedTime()
                    );
                    String[] pathSegments = uri.getPath().split("/");
                    String filename = pathSegments[pathSegments.length - 1];

                    fileStat.put("name", filename);
                    fileStat.put("url", uri.getPath());
                    if (permissions.charAt(0) == 'l') {
                      fileStat.put("isLink", true);
                      try {
                        String linkTarget = sftp.getSymbolicLinkTarget(
                          uri.getPath()
                        );
                        fileStat.put("linkTarget", linkTarget);
                        SftpFileAttributes linkAttributes = sftp.stat(
                          linkTarget
                        );
                        fileStat.put("isFile", linkAttributes.isFile());
                        fileStat.put(
                          "isDirectory",
                          linkAttributes.isDirectory()
                        );
                      } catch (SftpStatusException | SshException e) {
                        // Handle broken symlink
                        fileStat.put("isFile", false);
                        fileStat.put("isDirectory", false);
                        fileStat.put("isLink", false);
                        fileStat.put("exists", false);
                      }
                    } else {
                      fileStat.put("isLink", false);
                      fileStat.put("isDirectory", fileAttributes.isDirectory());
                      fileStat.put("isFile", fileAttributes.isFile());
                    }
                  }
                } catch (SftpStatusException e) {
                  fileStat.put("exists", false);
                  fileStat.put("url", uri.getPath());
                }

                callback.success(fileStat);
                return;
              }
              callback.error("Not connected");
            } catch (URISyntaxException | JSONException | SshException e) {
              callback.error(errMessage(e));
            }
          }
        }
      );
  }

  public void mkdir(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String path = args.optString(0);
              if (ssh != null && sftp != null) {
                sftp.mkdir(path);
                callback.success();
                return;
              }
              callback.error("Not connected");
            } catch (SftpStatusException | SshException e) {
              callback.error(errMessage(e));
            }
          }
        }
      );
  }

  public void rm(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String path = args.optString(0);
              boolean force = args.optBoolean(1, false);
              boolean recurse = args.optBoolean(2, false);

              if (ssh != null && sftp != null) {
                sftp.rm(path, force, recurse);
                callback.success();
                return;
              }
              callback.error("Not connected");
            } catch (SftpStatusException | SshException e) {
              callback.error(errMessage(e));
            }
          }
        }
      );
  }

  public void createFile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String path = args.optString(0);
              String content = args.optString(1, "");

              if (ssh != null && sftp != null) {
                try {
                  SftpFileAttributes attrs = sftp.stat(path);
                  if (attrs != null && attrs.isFile()) {
                    callback.error("File already exists");
                    return;
                  }
                } catch (SftpStatusException e) {
                  // File doesn't exist, continue with creation
                }

                java.io.ByteArrayInputStream inputStream;
                if (content.isEmpty()) {
                  inputStream = new java.io.ByteArrayInputStream(new byte[0]);
                } else {
                  inputStream = new java.io.ByteArrayInputStream(
                    content.getBytes(StandardCharsets.UTF_8)
                  );
                }
                sftp.put(inputStream, path);
                callback.success();
                return;
              }
              callback.error("Not connected");
            } catch (
              SftpStatusException | SshException | TransferCancelledException e
            ) {
              callback.error(errMessage(e));
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
              String oldpath = args.optString(0);
              String newpath = args.optString(1);

              if (ssh != null && sftp != null) {
                sftp.rename(oldpath, newpath);
                callback.success();
                return;
              }
              callback.error("Not connected");
            } catch (SftpStatusException | SshException e) {
              callback.error(errMessage(e));
            }
          }
        }
      );
  }

  public void pwd(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              if (ssh != null && sftp != null) {
                String pwd = sftp.pwd();
                callback.success(pwd);
                return;
              }
              callback.error("Not connected");
            } catch (SftpStatusException | SshException e) {
              callback.error(errMessage(e));
            }
          }
        }
      );
  }

  private String sanitizePath(String path) {
    try {
      String decodedPath = URLDecoder.decode(
        path,
        StandardCharsets.UTF_8.toString()
      );
      String encodedPath = URLEncoder.encode(
        decodedPath,
        StandardCharsets.UTF_8.toString()
      )
        .replace("+", "%20") // Replace + with %20 for spaces
        .replace("%2F", "/") // Preserve forward slashes
        .replace("%5C", "\\"); // Preserve backslashes if needed

      return encodedPath;
    } catch (UnsupportedEncodingException e) {
      return path; // Return original if encoding fails
    }
  }

  public void close(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              if (ssh != null) {
                ssh.close();
                sftp.quit();
                callback.success();
                return;
              }
              callback.error("Not connected");
            } catch (IOException | SshException e) {
              callback.error(errMessage(e));
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
            if (
              ssh != null &&
              ssh.isConnected() &&
              sftp != null &&
              !sftp.isClosed()
            ) {
              callback.success(connectionID);
              return;
            }

            callback.success(0);
          }
        }
      );
  }

  public String errMessage(Exception e) {
    String res = e.getMessage();
    if (res == null || res.equals("")) {
      return e.toString();
    }

    return res;
  }
}
