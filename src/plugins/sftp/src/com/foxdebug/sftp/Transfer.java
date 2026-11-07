package com.foxdebug.sftp;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import com.sshtools.client.sftp.SftpClient;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Reads and writes file content for transfers between the device and the server.
 *
 * Local paths arrive from the page as either a `file://` path or a `content://`
 * URI, so the caller hands over a `Uri` and this resolves whichever form was
 * given. The previous implementation assumed `content://` unconditionally, which
 * fails for a plain path.
 */
final class Transfer {

  private static final int BUFFER_SIZE = 32768;

  private Transfer() {}

  /**
   * Download a remote file into a local destination.
   *
   * @param sftp connected client
   * @param context application context, for the content resolver
   * @param remotePath absolute remote path
   * @param localUri destination, as a `file://` or `content://` URI
   * @return bytes written
   */
  static long download(
    SftpClient sftp,
    Context context,
    String remotePath,
    String localUri
  ) throws Exception {
    Uri uri = Uri.parse(localUri);

    try (
      InputStream input = sftp.getInputStream(remotePath);
      OutputStream output = openLocalOutput(context, uri, localUri, "wt")
    ) {
      return copy(input, output);
    }
  }

  /**
   * Upload a local file to a remote destination.
   *
   * @param sftp connected client
   * @param context application context, for the content resolver
   * @param localUri source, as a `file://` or `content://` URI
   * @param remotePath absolute remote path
   * @return bytes read
   */
  static long upload(
    SftpClient sftp,
    Context context,
    String localUri,
    String remotePath
  ) throws Exception {
    Uri uri = Uri.parse(localUri);

    try (
      InputStream input = openLocalInput(context, uri, localUri);
      OutputStream output = sftp.getOutputStream(remotePath)
    ) {
      return copy(input, output);
    }
  }

  /**
   * Open a local file for reading, accepting either URI form.
   * @param context application context
   * @param uri parsed uri
   * @param raw original string, used in error messages
   */
  static InputStream openLocalInput(Context context, Uri uri, String raw)
    throws IOException {
    if ("file".equals(uri.getScheme())) {
      return new FileInputStream(fileFor(uri, raw));
    }

    InputStream input = context.getContentResolver().openInputStream(uri);
    if (input == null) throw new IOException("Could not open " + raw);
    return input;
  }

  /**
   * Open a local file for writing, accepting either URI form.
   * @param context application context
   * @param uri parsed uri
   * @param raw original string, used in error messages
   * @param mode content-resolver mode, e.g. `wt` to truncate
   */
  static OutputStream openLocalOutput(
    Context context,
    Uri uri,
    String raw,
    String mode
  ) throws IOException {
    if ("file".equals(uri.getScheme())) {
      return new FileOutputStream(fileFor(uri, raw));
    }

    ContentResolver resolver = context.getContentResolver();
    OutputStream output = resolver.openOutputStream(uri, mode);
    if (output == null) throw new IOException("Could not write " + raw);
    return output;
  }

  private static File fileFor(Uri uri, String raw) throws IOException {
    String path = uri.getPath();
    if (path == null) throw new IOException("Invalid local path: " + raw);
    return new File(path);
  }

  private static long copy(InputStream input, OutputStream output)
    throws IOException {
    byte[] buffer = new byte[BUFFER_SIZE];
    long total = 0;
    int read;
    while ((read = input.read(buffer)) != -1) {
      output.write(buffer, 0, read);
      total += read;
    }
    output.flush();
    return total;
  }
}
