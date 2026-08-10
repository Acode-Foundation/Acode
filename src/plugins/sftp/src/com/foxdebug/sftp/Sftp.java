package com.foxdebug.sftp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import androidx.documentfile.provider.DocumentFile;
import com.sshtools.client.SshClient;
import com.sshtools.client.SshClient.SshClientBuilder;
import com.sshtools.client.SshClientContext;
import com.sshtools.client.SessionChannelNG;
import com.sshtools.client.sftp.SftpClient;
import com.sshtools.client.sftp.SftpClient.SftpClientBuilder;
import com.sshtools.client.sftp.SftpFile;
import com.sshtools.client.sftp.TransferCancelledException;
import com.sshtools.common.knownhosts.HostKeyVerification;
import com.sshtools.common.permissions.PermissionDeniedException;
import com.sshtools.common.policy.FileSystemPolicy;
import com.sshtools.common.publickey.InvalidPassphraseException;
import com.sshtools.common.publickey.SshKeyUtils;
import com.sshtools.common.sftp.SftpFileAttributes;
import com.sshtools.common.sftp.SftpStatusException;
import com.sshtools.common.ssh.SshException;
import com.sshtools.common.ssh.Channel;
import com.sshtools.common.ssh.ChannelEventListener;
import com.sshtools.common.ssh.RequestFuture;
import com.sshtools.common.ssh.components.SshKeyPair;
import com.sshtools.common.ssh.components.SshPublicKey;
import com.sshtools.common.ssh.components.jce.JCEProvider;
import com.sshtools.common.util.UnsignedInteger32;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
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
import java.nio.ByteBuffer;
import java.nio.channels.UnresolvedAddressException;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

public class Sftp extends CordovaPlugin {

  private static final String TAG = "SFTP";
  // Maverick's 16 MB default is allocated in full for every SFTP subsystem.
  // A smaller mobile window prevents connection bursts from exhausting the heap.
  private static final long SFTP_MAX_WINDOW_SIZE = 1024L * 1024L;
  private static final long SFTP_MIN_WINDOW_SIZE = 128L * 1024L;
  private static boolean cryptoProviderConfigured;
  private final Object connectionLock = new Object();
  private final Map<String, RemoteShell> remoteShells = new ConcurrentHashMap<>();
  private SshClient ssh;
  private SftpClient sftp;
  private Context context;
  private Activity activity;
  private String connectionID;
  private SftpSecurityStore securityStore;

  private final class ConnectionSecurity {

    private final String hostname;
    private final int port;
    private volatile JSONObject failure;

    private ConnectionSecurity(String hostname, int port) {
      this.hostname = hostname;
      this.port = port;
    }

    private void configure(SshClientContext sshContext) {
      configureClient(sshContext);
      sshContext.setHostKeyVerification(
        new HostKeyVerification() {
          @Override
          public boolean verifyHost(String host, SshPublicKey publicKey)
            throws SshException {
            try {
              String fingerprint = publicKey.getFingerprint();
              String algorithm = publicKey.getAlgorithm();
              String encodedKey = Base64.encodeToString(
                publicKey.getEncoded(),
                Base64.NO_WRAP
              );
              String endpoint = hostname + ":" + port;
              JSONObject trusted = securityStore.getKnownHost(endpoint);
              if (trusted == null) {
                if (
                  confirmUnknownHost(endpoint, algorithm, fingerprint)
                ) {
                  securityStore.trustHost(
                    endpoint,
                    algorithm,
                    fingerprint,
                    encodedKey
                  );
                  return true;
                }
                failure = hostKeyFailure(
                  "HOST_KEY_REJECTED",
                  endpoint,
                  fingerprint,
                  null
                );
                return false;
              }

              String expected = trusted.optString("fingerprint");
              String expectedKey = trusted.optString("publicKey");
              if (
                (!expectedKey.isEmpty() && !encodedKey.equals(expectedKey)) ||
                (expectedKey.isEmpty() && !fingerprint.equals(expected))
              ) {
                failure = hostKeyFailure(
                  "HOST_KEY_CHANGED",
                  endpoint,
                  fingerprint,
                  expected
                );
                showChangedHostKey(endpoint, expected, fingerprint);
                return false;
              }
              return true;
            } catch (JSONException | InterruptedException e) {
              if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
              }
              throw new SshException(
                "Could not verify the SSH host key",
                SshException.HOST_KEY_ERROR,
                e
              );
            }
          }
        }
      );
    }

    private boolean report(CallbackContext callback) {
      JSONObject error = failure;
      failure = null;
      if (error == null) return false;
      callback.error(error);
      return true;
    }
  }

  private final class RemoteShell {

    private final String id;
    private final SshClient client;
    private final SessionChannelNG channel;
    private final CallbackContext streamCallback;
    private final AtomicBoolean finished = new AtomicBoolean(false);
    private final ExecutorService inputWriter = Executors.newSingleThreadExecutor();

    private RemoteShell(
      String id,
      SshClient client,
      SessionChannelNG channel,
      CallbackContext streamCallback
    ) {
      this.id = id;
      this.client = client;
      this.channel = channel;
      this.streamCallback = streamCallback;
    }

    private void sendData(ByteBuffer source) {
      if (finished.get() || source == null || !source.hasRemaining()) return;

      ByteBuffer data = source.asReadOnlyBuffer();
      byte[] bytes = new byte[data.remaining()];
      data.get(bytes);
      try {
        JSONObject event = new JSONObject();
        event.put("type", "data");
        event.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
        sendShellEvent(streamCallback, event, true);
      } catch (JSONException e) {
        finish(null, e.getMessage());
      }
    }

    private void finish(Integer exitCode, String error) {
      if (!finished.compareAndSet(false, true)) return;
      remoteShells.remove(id, this);
      inputWriter.shutdownNow();

      try {
        channel.close();
      } catch (Exception e) {
        Log.w(TAG, "Failed to close SSH shell channel " + id, e);
      }
      try {
        client.close();
      } catch (IOException e) {
        Log.w(TAG, "Failed to close SSH shell connection " + id, e);
      }

      try {
        JSONObject event = new JSONObject();
        event.put("type", error == null ? "exit" : "error");
        if (exitCode != null) event.put("exitCode", exitCode);
        if (error != null) event.put("message", error);
        sendShellEvent(streamCallback, event, false);
      } catch (JSONException e) {
        streamCallback.error(errMessage(e));
      }
    }

    private void write(String input, CallbackContext callback) {
      if (finished.get()) {
        callback.error("SSH shell is not connected");
        return;
      }

      try {
        inputWriter.execute(
          new Runnable() {
            @Override
            public void run() {
              try {
                byte[] data = input.getBytes(StandardCharsets.UTF_8);
                channel.getOutputStream().write(data);
                channel.getOutputStream().flush();
                callback.success();
              } catch (IOException e) {
                finish(null, errMessage(e));
                callback.error(errMessage(e));
              }
            }
          }
        );
      } catch (RejectedExecutionException e) {
        callback.error("SSH shell is not connected");
      }
    }
  }

  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    context = cordova.getContext();
    activity = cordova.getActivity();
    securityStore = new SftpSecurityStore(context);
    System.setProperty("maverick.log.nothread", "true");
    configureCryptoProvider();
  }

  private static synchronized void configureCryptoProvider() {
    if (cryptoProviderConfigured) return;

    Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME);
    Security.insertProviderAt(new BouncyCastleProvider(), 1);
    JCEProvider.enableBouncyCastle(true);
    cryptoProviderConfigured = true;
  }

  private static void configureClient(SshClientContext sshContext) {
    FileSystemPolicy policy = sshContext.getPolicy(FileSystemPolicy.class);
    policy.setSftpMaxWindowSize(
      new UnsignedInteger32(SFTP_MAX_WINDOW_SIZE)
    );
    policy.setSftpMinWindowSize(
      new UnsignedInteger32(SFTP_MIN_WINDOW_SIZE)
    );
    policy.setMaximumNumberofAsyncSFTPRequests(4);
  }

  private void closeConnectionQuietly() {
    SftpClient previousSftp = sftp;
    SshClient previousSsh = ssh;
    sftp = null;
    ssh = null;
    connectionID = null;

    if (previousSftp != null) {
      try {
        previousSftp.quit();
      } catch (Exception e) {
        Log.w(TAG, "Failed to close the SFTP subsystem", e);
      }
    }
    if (previousSsh != null) {
      try {
        previousSsh.close();
      } catch (Exception e) {
        Log.w(TAG, "Failed to close the SSH connection", e);
      }
    }
  }

  private boolean establishConnection(
    SshClientBuilder builder,
    String newConnectionID,
    ConnectionSecurity security
  ) throws IOException, SshException, PermissionDeniedException {
    synchronized (connectionLock) {
      closeConnectionQuietly();
      ssh = builder.onConfigure(security::configure).build();
      if (!ssh.isConnected()) {
        closeConnectionQuietly();
        return false;
      }

      connectionID = newConnectionID;
      try {
        sftp = SftpClientBuilder.create().withClient(ssh).build();
      } catch (IOException | SshException | PermissionDeniedException e) {
        closeConnectionQuietly();
        throw e;
      }

      try {
        sftp.getSubsystemChannel().setCharsetEncoding("UTF-8");
      } catch (UnsupportedEncodingException | SshException e) {
        Log.w(TAG, "Failed to set UTF-8 encoding, using the default", e);
      }
      return true;
    }
  }

  private static void sendShellEvent(
    CallbackContext callback,
    JSONObject event,
    boolean keepCallback
  ) {
    PluginResult result = new PluginResult(PluginResult.Status.OK, event);
    result.setKeepCallback(keepCallback);
    callback.sendPluginResult(result);
  }

  private static JSONObject hostKeyFailure(
    String code,
    String host,
    String fingerprint,
    String expectedFingerprint
  ) throws JSONException {
    JSONObject error = new JSONObject();
    error.put("code", code);
    error.put("host", host);
    error.put("fingerprint", fingerprint);
    if (expectedFingerprint != null) {
      error.put("expectedFingerprint", expectedFingerprint);
    }
    return error;
  }

  private boolean confirmUnknownHost(
    String endpoint,
    String algorithm,
    String fingerprint
  ) throws InterruptedException {
    if (activity == null || activity.isFinishing()) return false;

    CountDownLatch decision = new CountDownLatch(1);
    AtomicBoolean trusted = new AtomicBoolean(false);
    activity.runOnUiThread(
      () -> {
        AlertDialog dialog = new AlertDialog.Builder(activity)
          .setTitle("Unknown SSH host")
          .setMessage(
            "This is the first connection to " +
            endpoint +
            ".\n\nKey type: " +
            algorithm +
            "\nFingerprint: " +
            fingerprint +
            "\n\nVerify this fingerprint before trusting the host."
          )
          .setNegativeButton("Cancel", (ignored, which) -> decision.countDown())
          .setPositiveButton(
            "Trust and connect",
            (ignored, which) -> {
              trusted.set(true);
              decision.countDown();
            }
          )
          .create();
        dialog.setOnCancelListener(ignored -> decision.countDown());
        dialog.show();
      }
    );
    decision.await();
    return trusted.get();
  }

  private void showChangedHostKey(
    String endpoint,
    String expectedFingerprint,
    String receivedFingerprint
  ) {
    if (activity == null || activity.isFinishing()) return;
    activity.runOnUiThread(
      () ->
        new AlertDialog.Builder(activity)
          .setTitle("SSH host key changed")
          .setMessage(
            "The identity of " +
            endpoint +
            " has changed. The connection was blocked.\n\nExpected: " +
            expectedFingerprint +
            "\nReceived: " +
            receivedFingerprint
          )
          .setPositiveButton("Close", null)
          .show()
    );
  }

  private void closeRemoteShells() {
    for (RemoteShell shell : remoteShells.values()) {
      shell.finish(null, null);
    }
    remoteShells.clear();
  }

  @Override
  public void onReset() {
    closeRemoteShells();
    super.onReset();
  }

  @Override
  public void onDestroy() {
    closeRemoteShells();
    super.onDestroy();
  }

  private SshClientBuilder buildProfileBuilder(JSONObject profile)
    throws IOException, InvalidPassphraseException, JSONException {
    SshClientBuilder builder = SshClientBuilder.create()
      .withHostname(profile.getString("hostname"))
      .withPort(profile.optInt("port", 22))
      .withUsername(profile.getString("username"));

    if ("key".equals(profile.optString("authType"))) {
      byte[] privateKey = Base64.decode(
        profile.getString("privateKey"),
        Base64.NO_WRAP
      );
      SshKeyPair keyPair = SshKeyUtils.getPrivateKey(
        new ByteArrayInputStream(privateKey),
        profile.optString("passphrase")
      );
      builder.withIdentities(keyPair);
    } else {
      builder.withPassword(profile.optString("password"));
    }
    return builder;
  }

  private byte[] readUri(String uriString) throws IOException {
    if (uriString == null || uriString.isEmpty()) {
      throw new IOException("Private key file is required");
    }
    try (
      InputStream input = context
        .getContentResolver()
        .openInputStream(Uri.parse(uriString));
      ByteArrayOutputStream output = new ByteArrayOutputStream()
    ) {
      if (input == null) throw new IOException("Could not open key file");
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) != -1) {
        output.write(buffer, 0, read);
      }
      return output.toByteArray();
    }
  }

  private void openRemoteShell(
    SshClient shellClient,
    int columns,
    int rows,
    CallbackContext callback
  ) throws SshException, JSONException, IOException {
    if (!shellClient.isConnected()) {
      shellClient.close();
      throw new IOException("Failed to establish SSH connection");
    }

    String shellID = UUID.randomUUID().toString();
    SessionChannelNG channel;
    try {
      channel = shellClient.openSessionChannel(true);
    } catch (SshException e) {
      shellClient.close();
      throw e;
    }
    RemoteShell shell = new RemoteShell(shellID, shellClient, channel, callback);
    remoteShells.put(shellID, shell);

    channel.addEventListener(
      new ChannelEventListener() {
        @Override
        public void onChannelDataIn(Channel source, ByteBuffer data) {
          shell.sendData(data);
        }

        @Override
        public void onChannelExtendedData(
          Channel source,
          ByteBuffer data,
          int type
        ) {
          shell.sendData(data);
        }

        @Override
        public void onChannelClose(Channel source) {
          int exitCode = channel.getExitCode();
          shell.finish(
            exitCode == SessionChannelNG.EXITCODE_NOT_RECEIVED ? null : exitCode,
            null
          );
        }

        @Override
        public void onChannelError(Channel source, Throwable error) {
          shell.finish(null, error == null ? "SSH shell error" : error.toString());
        }
      }
    );

    RequestFuture pty = channel
      .allocatePseudoTerminal("xterm-256color", columns, rows)
      .waitFor(30000L);
    if (!pty.isSuccess()) {
      shell.finish(null, "Remote server rejected PTY allocation");
      return;
    }
    if (shell.finished.get()) return;

    RequestFuture start = channel.startShell().waitFor(30000L);
    if (!start.isSuccess()) {
      shell.finish(null, "Remote server rejected the interactive shell");
      return;
    }
    if (shell.finished.get()) return;

    JSONObject ready = new JSONObject();
    ready.put("type", "ready");
    ready.put("sessionId", shellID);
    sendShellEvent(callback, ready, true);
  }

  public void openShellUsingProfile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            ConnectionSecurity security = null;
            try {
              String profileID = args.optString(0);
              int columns = Math.max(1, args.optInt(1, 80));
              int rows = Math.max(1, args.optInt(2, 24));
              JSONObject profile = securityStore.getProfile(profileID);
              ConnectionSecurity profileSecurity = new ConnectionSecurity(
                profile.getString("hostname"),
                profile.optInt("port", 22)
              );
              security = profileSecurity;
              openRemoteShell(
                buildProfileBuilder(profile)
                  .onConfigure(profileSecurity::configure)
                  .build(),
                columns,
                rows,
                callback
              );
            } catch (InvalidPassphraseException e) {
              callback.error("Invalid passphrase for stored key");
            } catch (Exception e) {
              if (security != null && security.report(callback)) return;
              callback.error("Failed to open SSH shell: " + errMessage(e));
              Log.e(TAG, "Failed to open SSH shell from profile", e);
            }
          }
        }
      );
  }

  public void saveProfile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
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
              if ("key".equals(authType)) {
                profile.put(
                  "privateKey",
                  Base64.encodeToString(readUri(args.optString(6)), Base64.NO_WRAP)
                );
                profile.put("passphrase", args.optString(7));
              } else {
                profile.put("password", args.optString(5));
              }
              callback.success(securityStore.saveProfile(requestedID, profile));
            } catch (Exception e) {
              callback.error("Could not securely save SFTP profile: " + errMessage(e));
              Log.e(TAG, "Could not save SFTP profile", e);
            }
          }
        }
      );
  }

  public void editProfile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String requestedID = nullableProfileID(args);
              JSONObject existing = requestedID == null
                ? null
                : securityStore.getProfile(requestedID);
              String hostname = args.getString(1).trim();
              int port = args.optInt(2, 22);
              String username = args.getString(3).trim();
              String authType = args.optString(4, "password");
              if (hostname.isEmpty()) {
                throw new IllegalArgumentException("Hostname is required");
              }
              if (username.isEmpty()) {
                throw new IllegalArgumentException("Username is required");
              }
              if (port < 1 || port > 65535) {
                throw new IllegalArgumentException(
                  "Port must be between 1 and 65535"
                );
              }

              JSONObject profile = new JSONObject();
              profile.put("hostname", hostname);
              profile.put("port", port);
              profile.put("username", username);
              profile.put("authType", authType);
              if ("key".equals(authType)) {
                String keyFile = args.optString(6);
                if (!keyFile.isEmpty()) {
                  profile.put(
                    "privateKey",
                    Base64.encodeToString(readUri(keyFile), Base64.NO_WRAP)
                  );
                  profile.put("passphrase", args.optString(7));
                } else if (
                  existing != null &&
                  "key".equals(existing.optString("authType"))
                ) {
                  profile.put("privateKey", existing.getString("privateKey"));
                  profile.put("passphrase", existing.optString("passphrase"));
                } else {
                  throw new IllegalArgumentException(
                    "Select a private key file"
                  );
                }
              } else {
                String password = args.optString(5);
                if (
                  password.isEmpty() &&
                  existing != null &&
                  "password".equals(existing.optString("authType"))
                ) {
                  password = existing.optString("password");
                }
                profile.put("password", password);
              }

              String profileID = securityStore.saveProfile(
                requestedID,
                profile
              );
              callback.success(profileInfo(profileID, profile));
            } catch (Exception e) {
              callback.error(
                "Could not securely save SFTP profile: " + errMessage(e)
              );
              Log.e(TAG, "Could not save SFTP profile", e);
            }
          }
        }
      );
  }

  public void getProfileInfo(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            try {
              String profileID = args.getString(0);
              callback.success(
                profileInfo(profileID, securityStore.getProfile(profileID))
              );
            } catch (Exception e) {
              callback.error("Could not read SFTP profile: " + errMessage(e));
            }
          }
        }
      );
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

  public void deleteProfile(JSONArray args, CallbackContext callback) {
    String profileID = args.optString(0);
    try {
      JSONObject profile = securityStore.getProfile(profileID);
      String label = profile.optString("username") + "@" + profile.optString("hostname");
      activity.runOnUiThread(
        () -> {
          AlertDialog confirmation = new AlertDialog.Builder(activity)
            .setTitle("Delete saved SSH credentials?")
            .setMessage(
              "Remove the encrypted SFTP/SSH profile for " + label + "?"
            )
            .setNegativeButton(
              "Cancel",
              (ignored, which) -> callback.error("Profile deletion was cancelled")
            )
            .setPositiveButton(
              "Delete",
              (ignored, which) -> {
                securityStore.deleteProfile(profileID);
                callback.success();
              }
            )
            .create();
          confirmation.setOnCancelListener(
            ignored -> callback.error("Profile deletion was cancelled")
          );
          confirmation.show();
        }
      );
    } catch (Exception e) {
      callback.error("Could not delete SFTP profile: " + errMessage(e));
    }
  }

  public void writeShell(JSONArray args, CallbackContext callback) {
    RemoteShell shell = remoteShells.get(args.optString(0));
    if (shell == null || shell.finished.get()) {
      callback.error("SSH shell is not connected");
      return;
    }
    shell.write(args.optString(1), callback);
  }

  public void resizeShell(JSONArray args, CallbackContext callback) {
    String shellID = args.optString(0);
    RemoteShell shell = remoteShells.get(shellID);
    if (shell == null || shell.finished.get()) {
      callback.error("SSH shell is not connected");
      return;
    }
    shell.channel.changeTerminalDimensions(
      Math.max(1, args.optInt(1, 80)),
      Math.max(1, args.optInt(2, 24)),
      0,
      0
    );
    callback.success();
  }

  public void closeShell(JSONArray args, CallbackContext callback) {
    RemoteShell shell = remoteShells.get(args.optString(0));
    if (shell != null) shell.finish(null, null);
    callback.success();
  }

  public boolean execute(
    String action,
    JSONArray args,
    CallbackContext callback
  ) {
    if (!isAllowedAction(action)) {
      callback.error("SFTP action is not available: " + action);
      return false;
    }
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

  private static boolean isAllowedAction(String action) {
    switch (action) {
      case "exec":
      case "connectUsingProfile":
      case "saveProfile":
      case "editProfile":
      case "getProfileInfo":
      case "deleteProfile":
      case "getFile":
      case "putFile":
      case "lsDir":
      case "stat":
      case "mkdir":
      case "rm":
      case "createFile":
      case "rename":
      case "pwd":
      case "close":
      case "isConnected":
      case "openShellUsingProfile":
      case "writeShell":
      case "resizeShell":
      case "closeShell":
        return true;
      default:
        return false;
    }
  }

  public void connectUsingProfile(JSONArray args, CallbackContext callback) {
    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            ConnectionSecurity security = null;
            String profileID = args.optString(0);
            try {
              JSONObject profile = securityStore.getProfile(profileID);
              ConnectionSecurity profileSecurity = new ConnectionSecurity(
                profile.getString("hostname"),
                profile.optInt("port", 22)
              );
              security = profileSecurity;
              if (
                establishConnection(
                  buildProfileBuilder(profile),
                  profileID,
                  profileSecurity
                )
              ) {
                callback.success();
                return;
              }
              if (security.report(callback)) return;
              callback.error("Failed to establish SSH connection");
            } catch (InvalidPassphraseException e) {
              callback.error("Invalid passphrase for stored key");
            } catch (Exception e) {
              if (security != null && security.report(callback)) return;
              callback.error("Failed to connect SFTP profile: " + errMessage(e));
              Log.e(TAG, "Failed to connect SFTP profile", e);
            } catch (OutOfMemoryError e) {
              synchronized (connectionLock) {
                closeConnectionQuietly();
              }
              callback.error("Not enough memory to initialize SFTP");
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
                    contentResolver.openOutputStream(fileUri, "wt")
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
            SftpClient activeSftp = null;
            try {
              String path = args.optString(0);
              synchronized (connectionLock) {
                activeSftp = sftp;
                if (
                  ssh == null ||
                  !ssh.isConnected() ||
                  activeSftp == null ||
                  activeSftp.isClosed()
                ) {
                  callback.error("Not connected");
                  return;
                }
                JSONArray files = new JSONArray();
                for (SftpFile file : activeSftp.ls(path)) {
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
                        String linkTarget = activeSftp.getSymbolicLinkTarget(
                          file.getAbsolutePath()
                        );
                        fileInfo.put("linkTarget", linkTarget);
                        SftpFileAttributes linkAttributes = activeSftp.stat(
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
            } catch (SftpStatusException | JSONException e) {
              callback.error(errMessage(e));
            } catch (SshException | RuntimeException e) {
              invalidateSftpConnection(activeSftp, e);
              callback.error(
                "SFTP connection was interrupted. Reconnect and try again."
              );
            }
          }
        }
      );
  }

  private void invalidateSftpConnection(
    SftpClient failedSftp,
    Exception failure
  ) {
    synchronized (connectionLock) {
      if (failedSftp == null || sftp != failedSftp) return;
      Log.w(TAG, "Invalidating failed SFTP connection", failure);
      closeConnectionQuietly();
    }
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
            synchronized (connectionLock) {
              if (ssh != null || sftp != null) {
                closeConnectionQuietly();
                callback.success();
                return;
              }
              callback.success();
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
            synchronized (connectionLock) {
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
