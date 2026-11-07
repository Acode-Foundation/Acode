package com.foxdebug.sftp;

import android.util.Log;
import com.sshtools.client.SshClient;
import com.sshtools.client.SshClient.SshClientBuilder;
import com.sshtools.client.SshClientContext;
import com.sshtools.client.sftp.SftpClient;
import com.sshtools.client.sftp.SftpClient.SftpClientBuilder;
import com.sshtools.common.policy.FileSystemPolicy;
import com.sshtools.common.ssh.SshException;
import com.sshtools.common.util.UnsignedInteger32;
import java.io.UnsupportedEncodingException;
import org.json.JSONObject;

/**
 * The live SSH connection and its SFTP subsystem.
 *
 * One connection at a time: the plugin interface carries no connection id, so
 * there is nowhere to keep a second one. Everything that touches the client is
 * expected to run on the plugin's operation queue, which serialises access.
 */
final class SftpSession {

  private static final String TAG = "SFTP";

  // Maverick's 16 MB default is allocated in full for every SFTP subsystem.
  // A smaller mobile window keeps connection bursts from exhausting the heap.
  private static final long SFTP_MAX_WINDOW_SIZE = 1024L * 1024L;
  private static final long SFTP_MIN_WINDOW_SIZE = 128L * 1024L;

  // Seconds between keep-alive pings, so idle connections are not dropped by
  // mobile networks, NAT or the server.
  private static final int KEEP_ALIVE_INTERVAL_SECONDS = 30;

  private final Object lock = new Object();
  private SshClient ssh;
  private SftpClient sftp;
  private String connectionId;

  /**
   * Connect using an already configured builder.
   *
   * Any existing connection is closed first: the interface has no room for a
   * second one, and a half-open previous connection would be worse than none.
   *
   * @param builder configured client builder
   * @param id identifier reported to the page while connected
   * @return true when the connection and subsystem are both live
   */
  boolean connect(SshClientBuilder builder, String id) throws Exception {
    synchronized (lock) {
      close();
      SshClient client = builder.build();
      if (!client.isConnected()) {
        closeClient(client);
        return false;
      }

      SftpClient subsystem;
      try {
        subsystem = SftpClientBuilder.create().withClient(client).build();
      } catch (Exception e) {
        closeClient(client);
        throw e;
      }

      try {
        subsystem.getSubsystemChannel().setCharsetEncoding("UTF-8");
      } catch (UnsupportedEncodingException | SshException e) {
        Log.w(TAG, "Failed to set UTF-8 encoding, using the default", e);
      }

      ssh = client;
      sftp = subsystem;
      connectionId = id;
      return true;
    }
  }

  /**
   * The connected SFTP client, or null when there is no live connection.
   * @return client
   */
  SftpClient sftp() {
    synchronized (lock) {
      if (sftp == null || ssh == null || !ssh.isConnected() || sftp.isClosed()) {
        return null;
      }
      return sftp;
    }
  }

  /**
   * The identifier reported while connected, or null.
   * @return connection id
   */
  String connectionId() {
    synchronized (lock) {
      return connectionId;
    }
  }

  /**
   * A connected SSH client, for callers that need the whole connection
   * (running a command).
   * @return client, or null
   */
  SshClient ssh() {
    synchronized (lock) {
      return ssh;
    }
  }

  /** Close the connection and subsystem, ignoring errors. */
  void close() {
    synchronized (lock) {
      SftpClient previousSftp = sftp;
      SshClient previousSsh = ssh;
      sftp = null;
      ssh = null;
      connectionId = null;

      if (previousSftp != null) {
        try {
          previousSftp.quit();
        } catch (Exception e) {
          Log.w(TAG, "Failed to close the SFTP subsystem", e);
        }
      }
      closeClient(previousSsh);
    }
  }

  /**
   * Drop the connection only if it is still the one that failed, so a newer
   * connection is not closed by a stale failure.
   * @param failed client that failed
   */
  void invalidateIfCurrent(SftpClient failed) {
    synchronized (lock) {
      if (failed == null || failed != sftp) return;
      Log.w(TAG, "Invalidating a failed SFTP connection");
      close();
    }
  }

  private static void closeClient(SshClient client) {
    if (client == null) return;
    try {
      client.close();
    } catch (Exception e) {
      Log.w(TAG, "Failed to close the SSH connection", e);
    }
  }

  /**
   * Apply the mobile-friendly transfer window sizes and keep-alive to a client
   * context.
   * @param sshContext context being configured
   */
  static void configureClient(SshClientContext sshContext) {
    FileSystemPolicy policy = sshContext.getPolicy(FileSystemPolicy.class);
    policy.setSftpMaxWindowSize(new UnsignedInteger32(SFTP_MAX_WINDOW_SIZE));
    policy.setSftpMinWindowSize(new UnsignedInteger32(SFTP_MIN_WINDOW_SIZE));
    policy.setMaximumNumberofAsyncSFTPRequests(4);
    sshContext.setKeepAliveInterval(KEEP_ALIVE_INTERVAL_SECONDS);
  }

  /**
   * Build a client builder for a stored profile.
   * @param profile stored credentials
   * @param connectTimeout timeout in milliseconds
   * @return configured builder
   */
  static SshClientBuilder builderFor(JSONObject profile, long connectTimeout)
    throws Exception {
    SshClientBuilder builder = SshClientBuilder.create()
      .withHostname(profile.getString("hostname"))
      .withPort(profile.optInt("port", 22))
      .withConnectTimeout(connectTimeout)
      .withUsername(profile.getString("username"));

    if ("key".equals(profile.optString("authType"))) {
      byte[] privateKey = android.util.Base64.decode(
        profile.getString("privateKey"),
        android.util.Base64.NO_WRAP
      );
      builder.withIdentities(
        com.sshtools.common.publickey.SshKeyUtils.getPrivateKey(
          new java.io.ByteArrayInputStream(privateKey),
          profile.optString("passphrase")
        )
      );
    } else {
      builder.withPassword(profile.optString("password"));
    }
    return builder;
  }
}