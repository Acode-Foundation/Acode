package com.foxdebug.sftp;

import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Runs SFTP work one task at a time, in submission order.
 *
 * The SSH/SFTP client is not safe for concurrent use, and a transfer holds a
 * channel open for its whole duration. Cordova dispatches each plug-in call to a
 * different pool thread, so without serialising them a save that overlaps a
 * directory listing interleaves packets on the channel and tears it down
 * ("The channel unexpectedly terminated").
 *
 * The queue is created lazily and recreated after a shutdown, because Cordova
 * can reuse a plugin instance after a WebView reload; a queue left shut down
 * would silently drop every operation and stall every save with no callback.
 */
final class SftpOperationQueue {

  private static final String TAG = "SFTP";

  private final String name;
  private final Object lock = new Object();
  private volatile ExecutorService executor;

  /**
   * @param name thread name, for stack traces and logcat
   */
  SftpOperationQueue(String name) {
    this.name = name;
  }

  /**
   * Submit a task, creating the queue if needed.
   * @param task work to run
   * @return true when the task was accepted
   */
  boolean submit(Runnable task) {
    try {
      executor().execute(task);
      return true;
    } catch (RejectedExecutionException e) {
      // Only reachable while the plugin is being torn down.
      Log.w(TAG, "SFTP operation rejected during shutdown", e);
      return false;
    }
  }

  /**
   * Stop the queue. Any queued work is discarded and the running task is
   * interrupted, because it must not outlive the WebView waiting for it.
   */
  void shutdown() {
    synchronized (lock) {
      ExecutorService current = executor;
      executor = null;
      if (current != null) current.shutdownNow();
    }
  }

  private ExecutorService executor() {
    ExecutorService current = executor;
    if (current != null && !current.isShutdown()) return current;

    synchronized (lock) {
      if (executor == null || executor.isShutdown()) {
        executor = Executors.newSingleThreadExecutor(new NamedFactory(name));
      }
      return executor;
    }
  }

  /** Daemon threads, named so a stuck task is identifiable in a log. */
  private static final class NamedFactory implements ThreadFactory {

    private final String prefix;
    private final AtomicInteger counter = new AtomicInteger();

    private NamedFactory(String prefix) {
      this.prefix = prefix;
    }

    @Override
    public Thread newThread(Runnable runnable) {
      Thread thread = new Thread(
        runnable,
        prefix + "-" + counter.incrementAndGet()
      );
      thread.setDaemon(true);
      return thread;
    }
  }
}
