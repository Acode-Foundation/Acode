package com.foxdebug.sftp;

import com.sshtools.common.sftp.SftpFileAttributes;
import java.nio.file.attribute.FileTime;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Converts SFTP attributes into the JSON the page reads.
 *
 * Kept in one place so the two calls that report entries (`lsDir` and `stat`)
 * cannot disagree, and so the conversion rules are stated once.
 */
final class Metadata {

  private Metadata() {}

  /**
   * Describe one file or directory.
   *
   * @param name entry name
   * @param path absolute remote path
   * @param attributes server attributes, may be null
   * @return JSON payload for the page
   */
  static JSONObject describe(
    String name,
    String path,
    SftpFileAttributes attributes
  ) throws JSONException {
    JSONObject entry = new JSONObject();
    entry.put("name", name);
    entry.put("exists", true);

    if (attributes == null) {
      // A server that reports no attributes still has to produce a usable row.
      entry.put("isFile", false);
      entry.put("isDirectory", false);
      entry.put("isLink", false);
      entry.put("url", path);
      entry.put("length", 0);
      entry.put("lastModified", 0);
      return entry;
    }

    String permissions = attributes.toPermissionsString();
    boolean canRead = permissions.length() > 1 && permissions.charAt(1) == 'r';
    boolean canWrite = permissions.length() > 2 && permissions.charAt(2) == 'w';

    entry.put("canRead", canRead);
    entry.put("canWrite", canWrite);
    entry.put("permissions", permissions);
    // A directory reports a block size, not the size of its contents. Sending it
    // made every folder look like a small file when sorted by size.
    entry.put(
      "length",
      attributes.isDirectory() ? 0 : sizeOf(attributes)
    );
    entry.put("url", path);
    entry.put("lastModified", lastModifiedMillis(attributes));
    entry.put("isLink", attributes.isLink());
    entry.put("isDirectory", attributes.isDirectory());
    entry.put("isFile", attributes.isFile());
    return entry;
  }

  /**
   * Mirror an entry whose target should be resolved by the caller (a symlink).
   * @param entry entry to update
   * @param target absolute target path
   */
  static void addLinkTarget(JSONObject entry, String target)
    throws JSONException {
    entry.put("linkTarget", target);
  }

  /**
   * Fill in the attributes of a symlink's target, falling back to "broken link"
   * when the target cannot be read.
   * @param entry entry to update
   * @param attributes target attributes, or null when unreadable
   */
  static void applyLinkTarget(JSONObject entry, SftpFileAttributes attributes)
    throws JSONException {
    if (attributes == null) {
      entry.put("isFile", false);
      entry.put("isDirectory", false);
      entry.put("isLink", false);
      return;
    }
    entry.put("isFile", attributes.isFile());
    entry.put("isDirectory", attributes.isDirectory());
  }

  private static long sizeOf(SftpFileAttributes attributes) {
    try {
      return attributes.size().longValue();
    } catch (RuntimeException e) {
      return 0;
    }
  }

  /**
   * Milliseconds since the epoch, for direct use as a JavaScript `Date`.
   *
   * Serialising Maverick's `FileTime` straight into JSON produced a
   * human-readable string that JavaScript could not parse as a timestamp.
   * @param attributes server attributes
   * @return epoch milliseconds, or 0 when the server does not report a time
   */
  static long lastModifiedMillis(SftpFileAttributes attributes) {
    if (attributes == null || !attributes.hasLastModifiedTime()) return 0;
    try {
      FileTime time = attributes.lastModifiedTime();
      return time == null ? 0 : time.toMillis();
    } catch (RuntimeException e) {
      return 0;
    }
  }
}
