package com.foxdebug.acode.runtime;

import static org.junit.Assert.*;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.foxdebug.acode.MainActivity;
import com.foxdebug.acode.runtime.webview.AppWebView;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 29)
public class FileResourceTest {

  @Test
  public void servesEncodedFileNamesWithoutReinterpretingTheirCharacters()
    throws Exception {
    Thread.UncaughtExceptionHandler previous =
      Thread.getDefaultUncaughtExceptionHandler();
    try (
      org.robolectric.android.controller.ActivityController<
        MainActivity
      > controller = Robolectric.buildActivity(MainActivity.class).setup()
    ) {
      MainActivity activity = controller.get();
      AppWebView view = (AppWebView) activity.getContentView().getChildAt(0);
      android.webkit.WebViewClient client = view.getWebViewClient();
      byte[] bytes = {0, 127, (byte) 128, (byte) 255};
      for (String name : new String[] {
        "plain.txt",
        "hash # question ? 50% 日本語.txt",
        "literal %23.txt",
      }) {
        File file = new File(activity.getCacheDir(), name);
        Files.write(file.toPath(), bytes);
        try {
          Uri uri = Uri.parse("https://localhost/__cdvfile_cache__/")
            .buildUpon()
            .appendPath(name)
            .build();
          WebResourceResponse response = activity
            .getHost()
            .getThreadPool()
            .submit(() -> client.shouldInterceptRequest(view, request(uri)))
            .get(5, TimeUnit.SECONDS);
          assertNotNull(name, response);
          assertNotEquals(name, 404, response.getStatusCode());
          try (InputStream stream = response.getData()) {
            assertArrayEquals(name, bytes, stream.readAllBytes());
          }
        } finally {
          Files.deleteIfExists(file.toPath());
        }
      }
    } finally {
      Thread.setDefaultUncaughtExceptionHandler(previous);
    }
  }

  private static WebResourceRequest request(Uri uri) {
    return new WebResourceRequest() {
      public Uri getUrl() { return uri; }
      public boolean isForMainFrame() { return false; }
      public boolean isRedirect() { return false; }
      public boolean hasGesture() { return false; }
      public String getMethod() { return "GET"; }
      public Map<String, String> getRequestHeaders() {
        return Collections.emptyMap();
      }
    };
  }
}
