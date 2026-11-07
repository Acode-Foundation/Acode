package com.foxdebug.sftp;

import android.app.Activity;
import android.content.Context;
import android.util.Base64;
import android.util.Log;
import android.widget.Toast;
import com.sshtools.client.SshClient;
import com.sshtools.client.sftp.SftpClient;
import com.sshtools.client.sftp.SftpFile;
import com.sshtools.common.publickey.InvalidPassphraseException;
import com.sshtools.common.sftp.SftpFileAttributes;
import com.sshtools.common.ssh.SshException;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.FutureTask;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * SFTP and SSH for Cordova on Android.
 *
 * Every action the page can invoke is listed in {@link #execute}. Actions that
 * touch the SSH connection are handed to a single-thread queue, because the
 * client is not safe for concurrent use; the rest run on Cordova's pool.
 */
public class SftpPlugin extends CordovaPlugin {

  private static final String TAG = "SFTP";

  private static final long DEFAULT_CONNECT_TIMEOUT_MS = 10000L;
  private static final long MIN_CONNECT_TIMEOUT_MS = 1000L;
  // Covers the whole attempt, which may pause on a host key prompt.
  private static final long MAX_CONNECT_TIMEOUT_MS = 180000L;

  private static boolean cryptoProviderConfigured;

  private final SftpSession session = new SftpSession();
  private final SftpOperationQueue operations = new SftpOperationQueue(
    "sftp-operations"
  );
  private final Map<String, RemoteShell> shells = new ConcurrentHashMap<>();
  private final Map<String, ConnectionAttempt> attempts = new ConcurrentHashMap<>();

  private Context context;
  private Activity activity;
  private SftpSecurityStore securityStore;
  private WebConfirm confirm;

  @Override
  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    context = cordova.getContext();
    activity = cordova.getActivity();
    securityStore = new SftpSecurityStore(context);
    confirm = new WebConfirm(webView, activity);
    System.setProperty("maverick.log.nothread", "true");
    configureCryptoProvider();
  }

  private static synchronized void configureCryptoProvider() {
    if (cryptoProviderConfigured) return;
    java.security.Security.removeProvider(
      org.bouncycastle.jce.provider.BouncyCastleProvider.PROVIDER_NAME
    );
    java.security.Security.insertProviderAt(
      new org.bouncycastle.jce.provider.BouncyCastleProvider(),
      1
    );
    com.sshtools.common.ssh.components.jce.JCEProvider.enableBouncyCastle(true);
    cryptoProviderConfigured = true;
  }

  @Override
  public void onReset() {
    cancelAttempts();
    closeShells();
    confirm.releaseAll();
    super.onReset();
  }

  @Override
  public void onDestroy() {
    cancelAttempts();
    closeShells();
    confirm.releaseAll();
    operations.shutdown();
    super.onDestroy();
  }

  @Override
  public boolean execute(
    String action,
    JSONArray args,
    CallbackContext callback
  ) {
    switch (action) {
      // Lifecycle and storage: never touch the connection.
      case "isConnected":
        answerConnectionState(callback);
        return true;
      case "resolveConfirmation":
        confirm.resolve(args, callback);
        return true;
      case "showToast":
        showToast(args, callback);
        return true;
      case "saveProfile":
        saveProfile(args, callback);
        return true;
      case "editProfile":
        editProfile(args, callback);
        return true;
      case "getProfileInfo":
        getProfileInfo(args, callback);
        return true;
      case "deleteProfile":
        deleteProfile(args, callback);
        return true;

      // Connection attempts have their own cancellation and must not queue
      // behind a running transfer.
      case "connectUsingProfile":
        connect(args, callback, false);
        return true;
      case "testProfile":
        connect(args, callback, true);
        return true;
      case "cancelConnection":
        cancelConnection(args, callback);
        return true;

      // Shells own their own connections.
      case "openShellUsingProfile":
        openShell(args, callback);
        return true;
      case "writeShell":
        return writeShell(args, callback);
      case "resizeShell":
        return resizeShell(args, callback);
      case "closeShell":
        closeShell(args, callback);
        return true;

      // Everything below drives the shared SFTP client, so it is serialised.
      case "exec":
        operations.submit(() -> exec(args, callback));
        return true;
      case "getFile":
        operations.submit(() -> getFile(args, callback));
        return true;
      case "putFile":
        operations.submit(() -> putFile(args, callback));
        return true;
      case "lsDir":
        operations.submit(() -> lsDir(args, callback));
        return true;
      case "stat":
        operations.submit(() -> stat(args, callback));
        return true;
      case "mkdir":
        operations.submit(() -> mkdir(args, callback));
        return true;
      case "rm":
        operations.submit(() -> rm(args, callback));
        return true;
      case "createFile":
        operations.submit(() -> createFile(args, callback));
        return true;
      case "rename":
        operations.submit(() -> rename(args, callback));
        return true;
      case "pwd":
        operations.submit(() -> pwd(callback));
        return true;
      case "close":
        operations.submit(() -> {
          session.close();
          callback.success();
        });
        return true;

      default:
        callback.error("SFTP action is not available: " + action);
        return false;
    }
  }

  /**
   * Report the connection state.
   *
   * The page compares the answer against a profile id and treats anything
   * falsy as disconnected, so this replies with the id when connected and the
   * number 0 when not.
   *
   * The stored id alone is not enough: after the server drops an idle
   * connection the profile still looked connected, so the page skipped
   * reconnecting and every file call failed with "Not connected" until the
   * connection was reset. Ask the session whether it is still live.
   */
  private void answerConnectionState(CallbackContext callback) {
    String id = session.sftp() == null ? null : session.connectionId();
    if (id == null) callback.success(0);
    else callback.success(id);
  }

  // ---------------------------------------------------------------------
  // connection
  // ---------------------------------------------------------------------

  private void connect(
    JSONArray args,
    CallbackContext callback,
    boolean returnWorkingDirectory
  ) {
    String profileID = args.optString(0);
    String suppliedRequestID = args.optString(1);
    String requestID = suppliedRequestID.isEmpty()
      ? UUID.randomUUID().toString()
      : suppliedRequestID;
    long requested = args.optLong(2, DEFAULT_CONNECT_TIMEOUT_MS);
    long timeout = Math.max(
      MIN_CONNECT_TIMEOUT_MS,
      Math.min(requested, MAX_CONNECT_TIMEOUT_MS)
    );

    ConnectionAttempt attempt = new ConnectionAttempt(callback);
    if (attempts.putIfAbsent(requestID, attempt) != null) {
      callback.error("An SFTP connection with this request ID is already running");
      return;
    }

    FutureTask<Void> task = new FutureTask<Void>(() -> {
      HostKeyVerifier verifier = null;
      try {
        JSONObject profile = securityStore.getProfile(profileID);
        verifier = new HostKeyVerifier(
          securityStore,
          confirm,
          profile.getString("hostname") + ":" + profile.optInt("port", 22)
        );

        com.sshtools.client.SshClient.SshClientBuilder builder =
          SftpSession.builderFor(profile, timeout);
        builder.onConfigure(verifier::configure);

        boolean connected = session.connect(builder, profileID);
        if (attempt.isCancelled()) return null;

        if (connected) {
          if (returnWorkingDirectory) {
            SftpClient client = session.sftp();
            if (client == null) throw new IOException("Connection closed early");
            attempt.success(client.pwd());
          } else {
            attempt.success();
          }
          return null;
        }

        if (!reportSecurityFailure(verifier, attempt)) {
          attempt.error("Failed to establish SSH connection");
        }
      } catch (InvalidPassphraseException e) {
        attempt.error("Invalid passphrase for stored key");
      } catch (Exception e) {
        if (attempt.isCancelled()) return null;
        if (!reportSecurityFailure(verifier, attempt)) {
          attempt.error("Failed to connect SFTP profile: " + errMessage(e));
          Log.e(TAG, "Failed to connect SFTP profile", e);
        }
      } catch (OutOfMemoryError e) {
        session.close();
        attempt.error("Not enough memory to initialize SFTP");
      }
      return null;
    }) {
      @Override
      protected void done() {
        attempts.remove(requestID, attempt);
      }
    };

    attempt.setFuture(task);
    cordova.getThreadPool().execute(task);
  }

  /** Report a host key failure if there is one, so the page can act on it. */
  private boolean reportSecurityFailure(
    HostKeyVerifier verifier,
    ConnectionAttempt attempt
  ) {
    if (verifier == null) return false;
    return verifier.reportFailure(attempt::error);
  }

  private void cancelConnection(JSONArray args, CallbackContext callback) {
    ConnectionAttempt attempt = attempts.get(args.optString(0));
    if (attempt != null) attempt.cancel();
    callback.success();
  }

  private void cancelAttempts() {
    for (ConnectionAttempt attempt : attempts.values()) attempt.cancel();
    attempts.clear();
  }

  // ---------------------------------------------------------------------
  // profiles
  // ---------------------------------------------------------------------

  private void saveProfile(JSONArray args, CallbackContext callback) {
    cordova.getThreadPool().execute(() -> {
      try {
        String requestedID = args.optString(0, null);
        if (requestedID != null && !requestedID.isEmpty()) {
          callback.error("Legacy profile import cannot replace a saved profile");
          return;
        }

        String authType = args.optString(4, "password");
        JSONObject profile = new JSONObject();
        profile.put("hostname", args.getString(1));
        profile.put("port", args.optInt(2, 22));
        profile.put("username", args.getString(3));
        profile.put("authType", authType);
        putCredentials(profile, args, authType, null);

        callback.success(securityStore.saveProfile(requestedID, profile));
      } catch (Exception e) {
        callback.error("Could not securely save SFTP profile: " + errMessage(e));
        Log.e(TAG, "Could not save SFTP profile", e);
      }
    });
  }

  private void editProfile(JSONArray args, CallbackContext callback) {
    cordova.getThreadPool().execute(() -> {
      try {
        String requestedID = nullableProfileID(args);
        JSONObject existing = requestedID == null
          ? null
          : securityStore.getProfile(requestedID);

        String hostname = args.getString(1).trim();
        int port = args.optInt(2, 22);
        String username = args.getString(3).trim();
        String authType = args.optString(4, "password");
        validateProfile(hostname, username, port);

        JSONObject profile = new JSONObject();
        profile.put("hostname", hostname);
        profile.put("port", port);
        profile.put("username", username);
        profile.put("authType", authType);
        putCredentials(profile, args, authType, existing);

        String profileID = securityStore.saveProfile(requestedID, profile);
        callback.success(profileInfo(profileID, profile));
      } catch (Exception e) {
        callback.error(
          "Could not securely save SFTP profile: " + errMessage(e)
        );
        Log.e(TAG, "Could not save SFTP profile", e);
      }
    });
  }

  /**
   * Copy credentials from the call into the profile.
   *
   * An empty secret on an edit keeps the stored one, so editing a connection
   * does not require re-entering the password or key.
   */
  private void putCredentials(
    JSONObject profile,
    JSONArray args,
    String authType,
    JSONObject existing
  ) throws Exception {
    if ("key".equals(authType)) {
      String keyFile = args.optString(6);
      boolean hadKey = existing != null &&
        "key".equals(existing.optString("authType"));

      if (!keyFile.isEmpty()) {
        profile.put(
          "privateKey",
          Base64.encodeToString(readUri(keyFile), Base64.NO_WRAP)
        );
        profile.put("passphrase", args.optString(7));
      } else if (hadKey) {
        profile.put("privateKey", existing.getString("privateKey"));
        profile.put("passphrase", existing.optString("passphrase"));
      } else {
        throw new IllegalArgumentException("Select a private key file");
      }
      return;
    }

    String password = args.optString(5);
    boolean keepStoredPassword =
      password.isEmpty() &&
      existing != null &&
      "password".equals(existing.optString("authType"));
    profile.put(
      "password",
      keepStoredPassword ? existing.optString("password") : password
    );
  }

  private static void validateProfile(String hostname, String username, int port) {
    if (hostname.isEmpty()) throw new IllegalArgumentException(
      "Hostname is required"
    );
    if (username.isEmpty()) throw new IllegalArgumentException(
      "Username is required"
    );
    if (port < 1 || port > 65535) throw new IllegalArgumentException(
      "Port must be between 1 and 65535"
    );
  }

  private void getProfileInfo(JSONArray args, CallbackContext callback) {
    cordova.getThreadPool().execute(() -> {
      try {
        String profileID = args.getString(0);
        callback.success(
          profileInfo(profileID, securityStore.getProfile(profileID))
        );
      } catch (Exception e) {
        callback.error("Could not read SFTP profile: " + errMessage(e));
      }
    });
  }

  private void deleteProfile(JSONArray args, CallbackContext callback) {
    try {
      // The app confirms before removing the storage this profile belongs to.
      securityStore.deleteProfile(args.optString(0));
      callback.success();
    } catch (Exception e) {
      callback.error("Could not delete SFTP profile: " + errMessage(e));
    }
  }

  private static JSONObject profileInfo(String profileID, JSONObject profile)
    throws JSONException {
    JSONObject info = new JSONObject();
    info.put("profileId", profileID);
    info.put("hostname", profile.getString("hostname"));
    info.put("port", profile.optInt("port", 22));
    info.put("username", profile.getString("username"));
    info.put("authType", profile.optString("authType", "password"));
    return info;
  }

  private static String nullableProfileID(JSONArray args) {
    if (args.length() == 0 || args.isNull(0)) return null;
    String value = args.optString(0, null);
    if (value == null) return null;
    value = value.trim();
    if (
      value.isEmpty() ||
      "null".equalsIgnoreCase(value) ||
      "undefined".equalsIgnoreCase(value)
    ) return null;
    return value;
  }

  private byte[] readUri(String uriString) throws IOException {
    if (uriString == null || uriString.isEmpty()) {
      throw new IOException("Private key file is required");
    }
    try (
      InputStream input = context
        .getContentResolver()
        .openInputStream(android.net.Uri.parse(uriString));
      ByteArrayOutputStream output = new ByteArrayOutputStream()
    ) {
      if (input == null) throw new IOException("Could not open key file");
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
      return output.toByteArray();
    }
  }

  // ---------------------------------------------------------------------
  // file operations
  // ---------------------------------------------------------------------

  private void exec(JSONArray args, CallbackContext callback) {
    try {
      SshClient ssh = session.ssh();
      if (ssh == null) {
        callback.error("Not connected");
        return;
      }
      StringBuffer buffer = new StringBuffer();
      int code = ssh.executeCommandWithResult(args.optString(0), buffer);
      JSONObject result = new JSONObject();
      result.put("code", code);
      result.put("result", buffer.toString());
      callback.success(result);
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void getFile(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      long bytes = Transfer.download(
        client,
        context,
        args.optString(0),
        args.optString(1)
      );
      JSONObject result = new JSONObject();
      result.put("bytes", bytes);
      callback.success(result);
    } catch (Exception e) {
      Log.e(TAG, "Error downloading file", e);
      // Only drop the connection when it is really broken. A missing file or
      // a permission error leaves it perfectly usable.
      if (isConnectionError(e)) invalidate(client);
      callback.error("File transfer error: " + errMessage(e));
    }
  }

  private void putFile(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      long bytes = Transfer.upload(
        client,
        context,
        args.optString(1),
        args.optString(0)
      );
      JSONObject result = new JSONObject();
      result.put("bytes", bytes);
      callback.success(result);
    } catch (Exception e) {
      Log.e(TAG, "Error uploading file", e);
      if (isConnectionError(e)) invalidate(client);
      callback.error("Error uploading file: " + errMessage(e));
    }
  }

  private void lsDir(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      JSONArray files = new JSONArray();
      for (SftpFile file : client.ls(args.optString(0))) {
        String name = file.getFilename();
        if (".".equals(name) || "..".equals(name)) continue;
        files.put(
          describe(client, name, file.getAbsolutePath(), file.attributes())
        );
      }
      callback.success(files);
    } catch (SshException | RuntimeException e) {
      invalidate(client);
      callback.error(
        "SFTP connection was interrupted. Reconnect and try again."
      );
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void stat(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      // Do not decode here. The page already decoded the URL: `Sftp.fromUrl()`
      // runs it through `Url.decodeUrl()`, and `#safeName()` only escapes shell
      // quoting, never percent-encoding. Decoding a second time made
      // `sftp://profile-1/a%2520b.txt` arrive as `/a%20b.txt` from JavaScript
      // and become `/a b.txt` here, while the download still asked the server
      // for `/a%20b.txt`. The existence check and the download then addressed
      // different files, so a real document looked deleted and checkFiles()
      // cleared its uri.
      String path = args.optString(0);
      JSONObject entry;
      try {
        entry = describe(client, basename(path), path, client.stat(path));
      } catch (Exception missing) {
        // Report "does not exist" instead of failing: callers use this to test
        // for existence.
        entry = new JSONObject();
        entry.put("exists", false);
        entry.put("url", path);
      }
      callback.success(entry);
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  /** Describe an entry, resolving symlink targets. */
  private JSONObject describe(
    SftpClient client,
    String name,
    String path,
    SftpFileAttributes attributes
  ) throws JSONException {
    JSONObject entry = Metadata.describe(name, path, attributes);
    if (attributes == null || !attributes.isLink()) return entry;

    try {
      String target = client.getSymbolicLinkTarget(path);
      Metadata.addLinkTarget(entry, target);
      Metadata.applyLinkTarget(entry, client.stat(target));
    } catch (Exception broken) {
      // A link pointing nowhere is reported without attributes.
      Metadata.applyLinkTarget(entry, null);
    }
    return entry;
  }

  private void mkdir(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      client.mkdir(args.optString(0));
      callback.success();
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void rm(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      client.rm(
        args.optString(0),
        args.optBoolean(1, false),
        args.optBoolean(2, false)
      );
      callback.success();
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void createFile(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      String path = args.optString(0);
      if (exists(client, path)) {
        callback.error("File already exists");
        return;
      }
      byte[] content = args.optString(1, "").getBytes(StandardCharsets.UTF_8);
      client.put(new ByteArrayInputStream(content), path);
      callback.success();
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void rename(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      client.rename(args.optString(0), args.optString(1));
      callback.success();
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void pwd(CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      callback.success(client.pwd());
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private static boolean exists(SftpClient client, String path) {
    try {
      return client.stat(path) != null;
    } catch (Exception e) {
      return false;
    }
  }

  private void invalidate(SftpClient client) {
    session.invalidateIfCurrent(client);
  }

  /**
   * True when the error means the connection itself is broken, not just that
   * one operation failed (missing file, permission denied and so on).
   */
  private static boolean isConnectionError(Throwable error) {
    Throwable current = error;
    int depth = 0;
    while (current != null && depth < 10) {
      if (
        current instanceof SshException ||
        current instanceof SocketException ||
        current instanceof EOFException
      ) return true;
      String message = current.getMessage();
      if (message != null) {
        String lower = message.toLowerCase();
        if (
          lower.contains("channel unexpectedly terminated") ||
          lower.contains("connection reset") ||
          lower.contains("broken pipe") ||
          lower.contains("connection closed") ||
          lower.contains("socket closed")
        ) return true;
      }
      current = current.getCause();
      depth++;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // shells
  // ---------------------------------------------------------------------

  private void openShell(JSONArray args, CallbackContext callback) {
    cordova.getThreadPool().execute(() -> {
      HostKeyVerifier verifier = null;
      try {
        JSONObject profile = securityStore.getProfile(args.optString(0));
        verifier = new HostKeyVerifier(
          securityStore,
          confirm,
          profile.getString("hostname") + ":" + profile.optInt("port", 22)
        );

        RemoteShell shell = RemoteShell.open(
          SftpSession.builderFor(profile, DEFAULT_CONNECT_TIMEOUT_MS)
            .onConfigure(verifier::configure)
            .build(),
          Math.max(1, args.optInt(1, 80)),
          Math.max(1, args.optInt(2, 24)),
          callback
        );
        if (shell != null) shells.put(shell.id(), shell);
      } catch (InvalidPassphraseException e) {
        callback.error("Invalid passphrase for stored key");
      } catch (Exception e) {
        if (verifier != null && verifier.reportFailure(callback::error)) return;
        callback.error("Failed to open SSH shell: " + errMessage(e));
        Log.e(TAG, "Failed to open SSH shell from profile", e);
      }
    });
  }

  private boolean writeShell(JSONArray args, CallbackContext callback) {
    RemoteShell shell = shells.get(args.optString(0));
    if (shell == null || shell.isFinished()) {
      callback.error("SSH shell is not connected");
      return true;
    }
    shell.write(args.optString(1), callback);
    return true;
  }

  private boolean resizeShell(JSONArray args, CallbackContext callback) {
    RemoteShell shell = shells.get(args.optString(0));
    if (shell == null || shell.isFinished()) {
      callback.error("SSH shell is not connected");
      return true;
    }
    shell.resize(
      Math.max(1, args.optInt(1, 80)),
      Math.max(1, args.optInt(2, 24))
    );
    callback.success();
    return true;
  }

  private void closeShell(JSONArray args, CallbackContext callback) {
    RemoteShell shell = shells.remove(args.optString(0));
    if (shell != null) shell.finish(null, null);
    callback.success();
  }

  private void closeShells() {
    for (RemoteShell shell : shells.values()) shell.finish(null, null);
    shells.clear();
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  private void showToast(JSONArray args, CallbackContext callback) {
    String message = args.optString(0);
    if (message != null && !message.isEmpty()) {
      Toast.makeText(context, message, Toast.LENGTH_LONG).show();
    }
    callback.success();
  }

  /**
   * A connection attempt that can be cancelled, and that reports exactly one
   * outcome however many callbacks arrive.
   */
  private static final class ConnectionAttempt {

    private final CallbackContext callback;
    private final java.util.concurrent.atomic.AtomicBoolean cancelled =
      new java.util.concurrent.atomic.AtomicBoolean(false);
    private final java.util.concurrent.atomic.AtomicBoolean completed =
      new java.util.concurrent.atomic.AtomicBoolean(false);
    private volatile java.util.concurrent.Future<?> future;

    private ConnectionAttempt(CallbackContext callback) {
      this.callback = callback;
    }

    private void setFuture(java.util.concurrent.Future<?> future) {
      this.future = future;
      if (cancelled.get()) future.cancel(true);
    }

    private boolean isCancelled() {
      return cancelled.get();
    }

    private void cancel() {
      cancelled.set(true);
      java.util.concurrent.Future<?> current = future;
      if (current != null) current.cancel(true);
      JSONObject error = new JSONObject();
      try {
        error.put("code", "SFTP_CONNECT_CANCELLED");
        error.put("message", "SFTP connection cancelled");
        error.put("cancelled", true);
        error.put("nonRetryable", true);
      } catch (JSONException ignored) {}
      error(error);
    }

    private void success() {
      if (completed.compareAndSet(false, true)) callback.success();
    }

    private void success(String value) {
      if (completed.compareAndSet(false, true)) callback.success(value);
    }

    private void error(JSONObject error) {
      if (completed.compareAndSet(false, true)) callback.error(error);
    }

    private void error(String message) {
      if (completed.compareAndSet(false, true)) callback.error(message);
    }
  }

  private static String basename(String path) {
    String[] segments = path.split("/");
    return segments.length == 0 ? path : segments[segments.length - 1];
  }

  static String errMessage(Exception e) {
    String message = e.getMessage();
    return message == null || message.isEmpty() ? e.toString() : message;
  }
}
