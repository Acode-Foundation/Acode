package com.foxdebug.sftp;

import android.util.Base64;
import android.util.Log;
import com.sshtools.client.SshClientContext;
import com.sshtools.common.knownhosts.HostKeyVerification;
import com.sshtools.common.ssh.SshException;
import com.sshtools.common.ssh.components.SshPublicKey;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Verifies SSH host keys, trusting a host the first time it is seen and asking
 * before replacing a key that changed.
 *
 * The SSH specification requires a client to reject a key it did not expect.
 * Silently accepting one would make a man-in-the-middle invisible, so a changed
 * key stops the connection unless the person explicitly accepts the new one.
 */
final class HostKeyVerifier {

  private static final String TAG = "SFTP";

  private final SftpSecurityStore securityStore;
  private final WebConfirm confirm;
  private final String endpoint;

  /** Failure recorded during verification, reported to the caller afterwards. */
  private volatile JSONObject failure;

  /**
   * @param securityStore trusted-host storage
   * @param confirm prompt shown when a decision is needed
   * @param endpoint `host:port`, the key trusted-host records are keyed by
   */
  HostKeyVerifier(
    SftpSecurityStore securityStore,
    WebConfirm confirm,
    String endpoint
  ) {
    this.securityStore = securityStore;
    this.confirm = confirm;
    this.endpoint = endpoint;
  }

  /**
   * Apply this verifier and the network policy to a client context.
   * @param sshContext context being configured
   */
  void configure(SshClientContext sshContext) {
    SftpSession.configureClient(sshContext);
    sshContext.setHostKeyVerification(new Verifier());
  }

  /**
   * Hand a recorded failure to the caller, if verification failed.
   * @param callback destination for the error
   * @return true when an error was reported
   */
  boolean reportFailure(ErrorSink sink) {
    JSONObject error = takeFailure();
    if (error == null) return false;
    sink.error(error);
    return true;
  }

  /** Where a recorded failure is delivered; the caller decides how. */
  interface ErrorSink {
    void error(JSONObject error);
  }

  private JSONObject takeFailure() {
    JSONObject error = failure;
    failure = null;
    return error;
  }

  private final class Verifier implements HostKeyVerification {

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

        JSONObject trusted = securityStore.getKnownHost(endpoint);
        if (trusted == null) return trustNewHost(algorithm, fingerprint, encodedKey);
        return verifyKnownHost(trusted, algorithm, fingerprint, encodedKey);
      } catch (JSONException | InterruptedException e) {
        if (e instanceof InterruptedException) Thread.currentThread().interrupt();
        throw new SshException(
          "Could not verify the SSH host key",
          SshException.HOST_KEY_ERROR,
          e
        );
      }
    }

    /** First connection to this host. */
    private boolean trustNewHost(
      String algorithm,
      String fingerprint,
      String encodedKey
    ) throws JSONException, InterruptedException {
      String message =
        "This is the first connection to " +
        endpoint +
        ".\n\nKey type: " +
        algorithm +
        "\nFingerprint: " +
        fingerprint +
        "\n\nVerify this fingerprint before trusting the host.";

      if (confirm.ask("Unknown SSH host", message, "Trust and connect")) {
        securityStore.trustHost(endpoint, algorithm, fingerprint, encodedKey);
        return true;
      }

      failure = hostKeyFailure("HOST_KEY_REJECTED", fingerprint, null);
      return false;
    }

    /** Host seen before; its key must match the one on record. */
    private boolean verifyKnownHost(
      JSONObject trusted,
      String algorithm,
      String fingerprint,
      String encodedKey
    ) throws JSONException, InterruptedException {
      String expectedFingerprint = trusted.optString("fingerprint");
      String expectedKey = trusted.optString("publicKey");
      boolean matches = !expectedKey.isEmpty()
        ? encodedKey.equals(expectedKey)
        : fingerprint.equals(expectedFingerprint);
      if (matches) return true;

      // Ask before failing. Rejecting outright meant accepting the new key could
      // never take effect: every retry hit the same wall.
      String message =
        "The identity of " +
        endpoint +
        " has changed since you last connected.\n\nExpected: " +
        expectedFingerprint +
        "\nReceived: " +
        fingerprint +
        "\n\nOnly accept this if you changed the server yourself, or you have confirmed the new fingerprint with whoever runs it.";

      if (confirm.ask("SSH host key changed", message, "Trust new key")) {
        // Records are keyed by host, so this replaces the old fingerprint.
        securityStore.trustHost(endpoint, algorithm, fingerprint, encodedKey);
        return true;
      }

      failure = hostKeyFailure(
        "HOST_KEY_CHANGED",
        fingerprint,
        expectedFingerprint
      );
      return false;
    }
  }

  private JSONObject hostKeyFailure(
    String code,
    String fingerprint,
    String expectedFingerprint
  ) throws JSONException {
    JSONObject error = new JSONObject();
    error.put("code", code);
    error.put("host", endpoint);
    error.put("fingerprint", fingerprint);
    if (expectedFingerprint != null) {
      error.put("expectedFingerprint", expectedFingerprint);
    }
    return error;
  }

  /** Log helper kept local so the class has no other dependencies. */
  static void log(String message, Throwable error) {
    Log.w(TAG, message, error);
  }
}
