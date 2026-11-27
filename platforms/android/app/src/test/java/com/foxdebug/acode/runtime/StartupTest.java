package com.foxdebug.acode.runtime;

import static org.junit.Assert.*;

import android.os.Looper;
import com.foxdebug.acode.BuildConfig;
import com.foxdebug.acode.runtime.webview.AppWebView;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 29)
public class StartupTest {

  @Test
  public void startsAndResumesWithoutReloadingTheEditor() throws Exception {
    Thread.UncaughtExceptionHandler previous =
      Thread.getDefaultUncaughtExceptionHandler();
    try (
      org.robolectric.android.controller.ActivityController<
              BaseWebActivity
      > controller = Robolectric.buildActivity(activityClass())
    ) {
      BaseWebActivity activity = controller.create().start().resume().get();
      AppWebView view = (AppWebView) activity
        .getContentView()
        .getChildAt(0);
      assertEquals("https://localhost/index.html", view.getUrl());
      android.content.pm.ActivityInfo info = activity
        .getPackageManager()
        .getActivityInfo(activity.getComponentName(), 0);
      assertEquals(activityClass().getName(), info.name);
      assertNotNull(view.getBridge().getService(ServiceName.FILE));
      assertNotNull(view.getBridge().getService(ServiceName.AUTHENTICATOR));
      assertNotNull(view.getBridge().getService(ServiceName.SYSTEM));
      if (BuildConfig.FLAVOR_edition.equals("free")) assertNotNull(
        view.getBridge().getService(ServiceName.AD_MOB)
      );
      else assertNull(view.getBridge().getService(ServiceName.AD_MOB));
      long generation = view.getBridge().getGeneration();
      controller.pause().resume();
      assertEquals(generation, view.getBridge().getGeneration());
    } finally {
      Thread.setDefaultUncaughtExceptionHandler(previous);
    }
  }

  @Test
  public void exposesEveryTransportKeyOnce() {
    java.util.HashSet<String> keys = new java.util.HashSet<>();
    for (ServiceName name : ServiceName.values()) {
      assertTrue("duplicate key " + name.getKey(), keys.add(name.getKey()));
    }
  }

  @Test
  public void routesOverlappingActivityRequestsToTheirOwners()
    throws Exception {
    Thread.UncaughtExceptionHandler previous =
      Thread.getDefaultUncaughtExceptionHandler();
    try (
      org.robolectric.android.controller.ActivityController<
              BaseWebActivity
      > controller = Robolectric.buildActivity(activityClass()).setup()
    ) {
      BaseWebActivity activity = controller.get();
      int[] received = new int[2];
      Service first = new Service() {
        @Override
        public void onActivityResult(
          int code,
          int result,
          android.content.Intent data
        ) {
          received[0] = code + result;
        }
      };
      Service second = new Service() {
        @Override
        public void onActivityResult(
          int code,
          int result,
          android.content.Intent data
        ) {
          received[1] = code + result;
        }
      };
      org.robolectric.shadows.ShadowActivity shadow = Shadows.shadowOf(
        activity
      );
      activity
        .getHost()
        .startActivityForResult(
          first,
          new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT),
          7
        );
      int firstId = shadow.getNextStartedActivityForResult().requestCode;
      activity
        .getHost()
        .startActivityForResult(
          second,
          new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT),
          7
        );
      int secondId = shadow.getNextStartedActivityForResult().requestCode;
      assertNotEquals(firstId, secondId);
      activity.getHost().onActivityResult(secondId, 20, null);
      activity.getHost().onActivityResult(firstId, 10, null);
      assertArrayEquals(new int[] {17, 27}, received);
    } finally {
      Thread.setDefaultUncaughtExceptionHandler(previous);
    }
  }

  @Test
  public void discardsCallbacksFromPreviousPageGenerations() throws Exception {
    Thread.UncaughtExceptionHandler previous =
      Thread.getDefaultUncaughtExceptionHandler();
    try (
      org.robolectric.android.controller.ActivityController<
              BaseWebActivity
      > controller = Robolectric.buildActivity(activityClass()).setup()
    ) {
      AppWebView view = (AppWebView) controller
        .get()
        .getContentView()
        .getChildAt(0);
      Callback old = new Callback(42, view);
      view.getBridge().reset();
      String before = Shadows.shadowOf(view).getLastEvaluatedJavascript();
      old.success("stale");
      Shadows.shadowOf(Looper.getMainLooper()).idle();
      assertEquals(before, Shadows.shadowOf(view).getLastEvaluatedJavascript());
      new Callback(42, view).success("current");
      Shadows.shadowOf(Looper.getMainLooper()).idle();
      assertTrue(
        Shadows.shadowOf(view).getLastEvaluatedJavascript().contains("current")
      );
    } finally {
      Thread.setDefaultUncaughtExceptionHandler(previous);
    }
  }

  @Test
  public void hardwareBackReachesFullscreenOwnerBeforeWebView()
    throws Exception {
    Thread.UncaughtExceptionHandler previous =
      Thread.getDefaultUncaughtExceptionHandler();
    try (
      org.robolectric.android.controller.ActivityController<
              BaseWebActivity
      > controller = Robolectric.buildActivity(activityClass()).setup()
    ) {
      BaseWebActivity activity = controller.get();
      AppWebView view = (AppWebView) activity
        .getContentView()
        .getChildAt(0);
      com.foxdebug.acode.runtime.webview.AcodeChromeClient chrome =
        (com.foxdebug.acode.runtime.webview.AcodeChromeClient) view.getWebChromeClient();
      int[] hidden = {0};
      chrome.onShowCustomView(
        new android.view.View(activity),
        () -> hidden[0]++
      );
      chrome.setBackHandler(true);
      assertTrue(
        activity.dispatchKeyEvent(
          new android.view.KeyEvent(
            android.view.KeyEvent.ACTION_DOWN,
            android.view.KeyEvent.KEYCODE_BACK
          )
        )
      );
      assertTrue(
        activity.dispatchKeyEvent(
          new android.view.KeyEvent(
            android.view.KeyEvent.ACTION_UP,
            android.view.KeyEvent.KEYCODE_BACK
          )
        )
      );
      assertTrue(chrome.isFullscreen());
      assertEquals(0, hidden[0]);
      assertTrue(
        Shadows.shadowOf(view)
          .getLastEvaluatedJavascript()
          .contains("fullscreenbackbutton")
      );
      chrome.setBackHandler(false);
      activity.dispatchKeyEvent(
        new android.view.KeyEvent(
          android.view.KeyEvent.ACTION_UP,
          android.view.KeyEvent.KEYCODE_BACK
        )
      );
      assertFalse(chrome.isFullscreen());
      assertEquals(1, hidden[0]);
    } finally {
      Thread.setDefaultUncaughtExceptionHandler(previous);
    }
  }

  @SuppressWarnings("unchecked")
  private static Class<BaseWebActivity> activityClass() {
    return (Class<BaseWebActivity>) (Class<?>) com.foxdebug.acode.MainActivity.class;
  }
}
