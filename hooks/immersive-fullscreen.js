const fs = require("node:fs");
const path = require("node:path");

// Patch Cordova's existing custom-view lifecycle rather than replacing its
// WebChromeClient (which also owns dialogs, permissions and file selection).
module.exports = function prepareImmersiveFullscreen(context) {
  if (!context.opts.platforms.includes("android")) return;

  const root = context.opts.projectRoot;
  const destination = path.join(
    root,
    "platforms/android/CordovaLib/src/org/apache/cordova",
  );
  const webViewPath = path.join(destination, "CordovaWebViewImpl.java");
  const controller = fs.readFileSync(
    path.join(root, "hooks/android/ImmersiveFullscreen.java"),
    "utf8",
  );
  const original = fs.readFileSync(webViewPath, "utf8");
  const newline = original.includes("\r\n") ? "\r\n" : "\n";

  // Markers delimit our generated blocks so each prepare can replace them safely,
  // including when only the controller changes.
  let source = original
    .replace(/\r\n/g, "\n")
    .replace(
      /^[ \t]*\/\/ ACODE_FULLSCREEN_BEGIN ([a-z]+)\n[\s\S]*?^[ \t]*\/\/ ACODE_FULLSCREEN_END \1\n/gm,
      "",
    );
  if (/ACODE_FULLSCREEN_(BEGIN|END)/.test(source)) {
    throw new Error(
      "Acode fullscreen: incomplete generated patch; regenerate the Android platform.",
    );
  }

  function insert(name, anchor, code, before = false) {
    const matches = [...source.matchAll(new RegExp(anchor.source, "gm"))];
    if (matches.length !== 1) {
      throw new Error(
        `Acode fullscreen: expected one Cordova ${name} anchor, found ${matches.length}. Update hooks/immersive-fullscreen.js for this Cordova version.`,
      );
    }
    const indent = matches[0][1];
    const block = [
      `// ACODE_FULLSCREEN_BEGIN ${name}`,
      ...code.trim().split("\n"),
      `// ACODE_FULLSCREEN_END ${name}`,
    ]
      .map((line) => indent + line)
      .join("\n");
    source = source.replace(anchor, (match) =>
      before ? `${block}\n${match}` : `${match}\n${block}`,
    );
  }

  // System calls these setters on the UI thread; null releases the orientation override.
  insert(
    "field",
    /^([ \t]*)private View mCustomView;[ \t]*$/m,
    `
private ImmersiveFullscreen immersiveFullscreen;
private boolean fullscreenPaused;
private boolean fullscreenBackHandlerEnabled;

public void setFullscreenBackHandler(boolean enabled) {
    if (enabled && (mCustomView == null || !mCustomView.isAttachedToWindow() || fullscreenPaused)) {
        throw new IllegalStateException("Back handler requires foreground fullscreen.");
    }
    fullscreenBackHandlerEnabled = enabled;
}

public void setFullscreenOrientation(String orientation) {
    if (orientation == null) {
        if (immersiveFullscreen != null) immersiveFullscreen.unlockOrientation();
        return;
    }
    if (immersiveFullscreen == null) {
        throw new IllegalStateException("Orientation requires foreground fullscreen.");
    }
    immersiveFullscreen.lockOrientation(orientation);
}
`,
  );
  // CoreAndroid's message channel accepts only Cordova's built-in events.
  insert(
    "back",
    /(?<=if \(isBackButton && mCustomView != null\) \{\n)^([ \t]*)hideCustomView\(\);\n[ \t]*return true;[ \t]*$/m,
    `
if (fullscreenBackHandlerEnabled) {
    engine.evaluateJavascript("cordova.fireDocumentEvent('fullscreenbackbutton');", null);
    return true;
}
`,
    true,
  );
  insert(
    "enter",
    /^([ \t]*)parent\.bringToFront\(\);[ \t]*$/m,
    `
fullscreenBackHandlerEnabled = false;
immersiveFullscreen = new ImmersiveFullscreen(cordova.getActivity(), !fullscreenPaused, () -> fullscreenBackHandlerEnabled = false);
immersiveFullscreen.enter(wrapperView);
`,
  );
  insert(
    "exit",
    /^([ \t]*)mCustomView\.setVisibility\(View\.GONE\);[ \t]*$/m,
    `
fullscreenBackHandlerEnabled = false;
if (immersiveFullscreen != null) {
    immersiveFullscreen.exit();
    immersiveFullscreen = null;
}
`,
    true,
  );
  insert(
    "pause",
    /^([ \t]*)pluginManager\.onPause\(keepRunning\);[ \t]*$/m,
    `
fullscreenPaused = true;
if (immersiveFullscreen != null) immersiveFullscreen.pause();
`,
    true,
  );
  insert(
    "resume",
    /^([ \t]*)this\.pluginManager\.onResume\(keepRunning\);[ \t]*$/m,
    `
fullscreenPaused = false;
if (immersiveFullscreen != null) immersiveFullscreen.resume();
`,
    true,
  );
  insert(
    "reset",
    /^([ \t]*)pluginManager\.onReset\(\);[ \t]*$/m,
    `
fullscreenBackHandlerEnabled = false;
if (immersiveFullscreen != null) immersiveFullscreen.unlockOrientation();
`,
    true,
  );
  // Release fullscreen while the WebView and its callback are still alive.
  insert(
    "destroy",
    /^([ \t]*)engine\.destroy\(\);[ \t]*$/m,
    `
fullscreenBackHandlerEnabled = false;
hideCustomView();
`,
    true,
  );

  // Validate all anchors before writing either generated file.
  fs.writeFileSync(
    path.join(destination, "ImmersiveFullscreen.java"),
    controller,
  );
  const patched = source.replace(/\n/g, newline);
  if (patched !== original) fs.writeFileSync(webViewPath, patched);
};
