package org.apache.cordova;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** Owns window state only while Cordova is displaying a browser fullscreen view. */
final class ImmersiveFullscreen
  implements
    ViewTreeObserver.OnWindowFocusChangeListener,
    View.OnAttachStateChangeListener
{

  @SuppressWarnings("deprecation")
  private static final int LEGACY_FULLSCREEN_FLAGS =
    View.SYSTEM_UI_FLAG_FULLSCREEN |
    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
    View.SYSTEM_UI_FLAG_IMMERSIVE |
    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;

  private final Activity activity;
  private final Window window;
  private final View decor;
  private final WindowInsetsControllerCompat controller;
  private final Runnable onExit;
  private View fullscreenView;
  private ViewTreeObserver focusObserver;
  private boolean statusBarVisible;
  private boolean navigationBarVisible;
  private int previousBehavior;
  private int previousCutoutMode;
  private int previousLegacyFlags;
  private boolean resumed;
  private Integer requestedOrientation;
  private int previousOrientation;
  private boolean orientationApplied;

  ImmersiveFullscreen(Activity activity, boolean resumed, Runnable onExit) {
    this.activity = activity;
    this.resumed = resumed;
    this.onExit = onExit;
    window = activity.getWindow();
    decor = window.getDecorView();
    controller = WindowCompat.getInsetsController(window, decor);
  }

  @SuppressWarnings("deprecation")
  void enter(View view) {
    if (fullscreenView != null) return;

    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
    int flags = decor.getSystemUiVisibility();
    statusBarVisible =
      insets != null
        ? insets.isVisible(WindowInsetsCompat.Type.statusBars())
        : (flags & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0 &&
          (window.getAttributes().flags &
            WindowManager.LayoutParams.FLAG_FULLSCREEN) == 0;
    navigationBarVisible =
      insets != null
        ? insets.isVisible(WindowInsetsCompat.Type.navigationBars())
        : (flags & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) == 0;
    previousBehavior = controller.getSystemBarsBehavior();
    previousLegacyFlags = flags & LEGACY_FULLSCREEN_FLAGS;
    if (Build.VERSION.SDK_INT >= 28) {
      WindowManager.LayoutParams attributes = window.getAttributes();
      previousCutoutMode = attributes.layoutInDisplayCutoutMode;
      attributes.layoutInDisplayCutoutMode =
        Build.VERSION.SDK_INT >= 30
          ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
          : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      window.setAttributes(attributes);
    }

    fullscreenView = view;
    // The wrapper fills Cordova's root, with no status/navigation bar margins.
    // Only the keyboard should shrink the usable area. Leave the root's inset
    // listener alone so normal editor layout is unchanged on exit.
    ViewCompat.setOnApplyWindowInsetsListener(view, (target, appliedInsets) -> {
      int bottom = appliedInsets
        .getInsets(WindowInsetsCompat.Type.ime())
        .bottom;
      target.setPadding(0, 0, 0, bottom);
      return appliedInsets;
    });
    view.addOnAttachStateChangeListener(this);
    focusObserver = decor.getViewTreeObserver();
    focusObserver.addOnWindowFocusChangeListener(this);
    reapply();
    ViewCompat.requestApplyInsets(view);
  }

  void reapply() {
    if (
      !resumed ||
      fullscreenView == null ||
      !fullscreenView.isAttachedToWindow() ||
      !decor.hasWindowFocus()
    ) return;
    controller.setSystemBarsBehavior(
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    );
    controller.hide(WindowInsetsCompat.Type.systemBars());
  }

  void lockOrientation(String orientation) {
    final int requested;
    if ("landscape".equals(orientation)) {
      requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
    } else if ("portrait".equals(orientation)) {
      requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
    } else {
      throw new IllegalArgumentException(
        "Orientation must be landscape or portrait."
      );
    }
    if (
      !resumed || fullscreenView == null || !fullscreenView.isAttachedToWindow()
    ) {
      throw new IllegalStateException(
        "Orientation requires foreground fullscreen."
      );
    }

    int previous = activity.getRequestedOrientation();
    activity.setRequestedOrientation(requested);
    // Only a successful first request owns the restoration state. Changing
    // modes or resuming this session must not replace it with our own override.
    if (requestedOrientation == null) previousOrientation = previous;
    requestedOrientation = requested;
    orientationApplied = true;
  }

  void unlockOrientation() {
    restoreOrientation();
    requestedOrientation = null;
  }

  void pause() {
    resumed = false;
    restoreOrientation();
  }

  void resume() {
    resumed = true;
    if (
      fullscreenView != null &&
      fullscreenView.isAttachedToWindow() &&
      requestedOrientation != null
    ) {
      activity.setRequestedOrientation(requestedOrientation);
      orientationApplied = true;
    }
    reapply();
  }

  private void restoreOrientation() {
    if (!orientationApplied) return;
    activity.setRequestedOrientation(previousOrientation);
    orientationApplied = false;
  }

  @SuppressWarnings("deprecation")
  void exit() {
    if (fullscreenView == null) return;
    View view = fullscreenView;
    fullscreenView = null;
    onExit.run();
    unlockOrientation();
    view.removeOnAttachStateChangeListener(this);
    ViewCompat.setOnApplyWindowInsetsListener(view, null);
    view.setPadding(0, 0, 0, 0);
    if (
      focusObserver.isAlive()
    ) focusObserver.removeOnWindowFocusChangeListener(this);
    focusObserver = null;

    controller.setSystemBarsBehavior(previousBehavior);
    restoreBar(WindowInsetsCompat.Type.statusBars(), statusBarVisible);
    restoreBar(WindowInsetsCompat.Type.navigationBars(), navigationBarVisible);
    if (Build.VERSION.SDK_INT < 30) {
      // Restore only the bits we own; keep any theme changes made meanwhile.
      decor.setSystemUiVisibility(
        (decor.getSystemUiVisibility() & ~LEGACY_FULLSCREEN_FLAGS) |
          previousLegacyFlags
      );
    }
    if (Build.VERSION.SDK_INT >= 28) {
      WindowManager.LayoutParams attributes = window.getAttributes();
      attributes.layoutInDisplayCutoutMode = previousCutoutMode;
      window.setAttributes(attributes);
    }
    ViewCompat.requestApplyInsets(decor);
  }

  private void restoreBar(int type, boolean visible) {
    if (visible) controller.show(type);
    else controller.hide(type);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    if (hasFocus) reapply();
  }

  @Override
  public void onViewAttachedToWindow(View view) {}

  @Override
  public void onViewDetachedFromWindow(View view) {
    exit();
  }
}
