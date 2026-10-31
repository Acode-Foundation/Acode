package com.foxdebug.voice;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Native speech recognition bridge.
 *
 * <p>One recognizer session is active at a time. Recognition events are sent
 * over a single long-lived callback, while start/stop/cancel calls resolve
 * their own callbacks. The recognizer is always created, started and destroyed
 * on the UI thread because Android requires it.</p>
 */
public class VoicePlugin extends CordovaPlugin {

  private static final String TAG = "AcodeVoice";
  private static final int REQUEST_RECORD_AUDIO = 0x564F;
  private static final long STOP_TIMEOUT_MS = 3000L;
  private static final long RESTART_DELAY_MS = 300L;
  private static final long RMS_THROTTLE_MS = 80L;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  private CallbackContext eventCallback;
  private CallbackContext startCallback;
  private CallbackContext stopCallback;
  private CallbackContext permissionCallback;
  private CallbackContext pendingStartCallback;
  private JSONObject pendingStartOptions;

  private SpeechRecognizer recognizer;
  private Intent lastIntent;
  private boolean listening;
  private boolean stopping;
  private boolean continuous;
  private boolean partialResults = true;
  private long lastRmsAt;

  private final Runnable restartRunnable = new Runnable() {
    @Override
    public void run() {
      restartRecognition();
    }
  };

  private final Runnable stopTimeoutRunnable = new Runnable() {
    @Override
    public void run() {
      if (stopCallback == null) return;
      stopCallback.success(stateJson());
      stopCallback = null;
      cleanupRecognizer();
      emit("end", stateJson());
    }
  };

  @Override
  public boolean execute(String action, JSONArray args, CallbackContext callbackContext) {
    try {
      switch (action) {
        case "setCallback":
          setCallback(callbackContext);
          return true;
        case "isAvailable":
          isAvailable(callbackContext);
          return true;
        case "hasPermission":
          callbackContext.success(hasPermission() ? 1 : 0);
          return true;
        case "requestPermission":
          requestPermission(callbackContext);
          return true;
        case "start":
          start(args.optJSONObject(0), callbackContext);
          return true;
        case "stop":
          stop(callbackContext);
          return true;
        case "cancel":
          cancel(callbackContext);
          return true;
        case "getState":
          getState(callbackContext);
          return true;
        default:
          return false;
      }
    } catch (Exception error) {
      Log.e(TAG, "Voice action failed: " + action, error);
      callbackContext.error(errorJson("internal_error", safeMessage(error)));
      return true;
    }
  }

  private void setCallback(CallbackContext callbackContext) {
    eventCallback = callbackContext;
    PluginResult keepResult = new PluginResult(PluginResult.Status.NO_RESULT);
    keepResult.setKeepCallback(true);
    callbackContext.sendPluginResult(keepResult);
  }

  private void isAvailable(CallbackContext callbackContext) {
    Context context = cordova.getContext();
    boolean available = SpeechRecognizer.isRecognitionAvailable(context);
    boolean onDevice =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(context);

    JSONObject result = new JSONObject();
    put(result, "available", available);
    put(result, "onDevice", onDevice);
    put(result, "permission", hasPermission());
    callbackContext.success(result);
  }

  private void getState(CallbackContext callbackContext) {
    JSONObject state = stateJson();
    put(state, "available", SpeechRecognizer.isRecognitionAvailable(cordova.getContext()));
    put(state, "permission", hasPermission());
    callbackContext.success(state);
  }

  private boolean hasPermission() {
    return cordova.hasPermission(Manifest.permission.RECORD_AUDIO);
  }

  private void requestPermission(final CallbackContext callbackContext) {
    if (hasPermission()) {
      callbackContext.success(1);
      return;
    }

    permissionCallback = callbackContext;
    cordova.getActivity().runOnUiThread(() -> {
      try {
        cordova.requestPermission(VoicePlugin.this, REQUEST_RECORD_AUDIO, Manifest.permission.RECORD_AUDIO);
      } catch (Exception error) {
        permissionCallback = null;
        callbackContext.error(errorJson("permission_request_failed", safeMessage(error)));
      }
    });
  }

  private void start(final JSONObject options, final CallbackContext callbackContext) {
    if (!hasPermission()) {
      if (pendingStartCallback != null) {
        callbackContext.error(errorJson("permission_pending", "Microphone permission is already being requested."));
        return;
      }
      if (permissionCallback != null) {
        permissionCallback.error(errorJson("permission_request_superseded", "The microphone permission request was replaced."));
        permissionCallback = null;
      }

      pendingStartOptions = options != null ? options : new JSONObject();
      pendingStartCallback = callbackContext;
      cordova.getActivity().runOnUiThread(() -> {
        try {
          cordova.requestPermission(VoicePlugin.this, REQUEST_RECORD_AUDIO, Manifest.permission.RECORD_AUDIO);
        } catch (Exception error) {
          clearPendingStart();
          callbackContext.error(errorJson("permission_request_failed", safeMessage(error)));
        }
      });
      return;
    }

    startRecognition(options, callbackContext);
  }

  private void startRecognition(final JSONObject options, final CallbackContext callbackContext) {
    final JSONObject resolved = options != null ? options : new JSONObject();

    cordova.getActivity().runOnUiThread(() -> {
      if (listening) {
        callbackContext.error(errorJson("already_listening", "Voice recognition is already running."));
        return;
      }

      Context context = cordova.getContext();
      if (!SpeechRecognizer.isRecognitionAvailable(context)) {
        callbackContext.error(errorJson("unavailable", "Speech recognition is not available on this device."));
        return;
      }

      try {
        continuous = resolved.optBoolean("continuous", false);
        partialResults = resolved.optBoolean("partialResults", true);
        stopping = false;
        lastIntent = buildIntent(resolved);
        createRecognizer(resolved.optBoolean("onDevice", false));

        listening = true;
        startCallback = callbackContext;
        recognizer.startListening(lastIntent);

        JSONObject state = stateJson();
        emit("start", state);
        if (startCallback != null) {
          startCallback.success(state);
          startCallback = null;
        }
      } catch (Exception error) {
        startCallback = null;
        cleanupRecognizer();
        callbackContext.error(errorJson("start_failed", safeMessage(error)));
      }
    });
  }

  private void stop(final CallbackContext callbackContext) {
    cordova.getActivity().runOnUiThread(() -> {
      if (!listening || recognizer == null) {
        callbackContext.success(stateJson());
        return;
      }

      if (stopCallback != null) {
        stopCallback.error(errorJson("stop_pending", "A previous stop request is still pending."));
        stopCallback = null;
      }

      continuous = false;
      stopping = true;
      stopCallback = callbackContext;

      try {
        recognizer.stopListening();
        mainHandler.removeCallbacks(stopTimeoutRunnable);
        mainHandler.postDelayed(stopTimeoutRunnable, STOP_TIMEOUT_MS);
      } catch (Exception error) {
        stopCallback = null;
        cleanupRecognizer();
        callbackContext.error(errorJson("stop_failed", safeMessage(error)));
      }
    });
  }

  private void cancel(final CallbackContext callbackContext) {
    cordova.getActivity().runOnUiThread(() -> {
      continuous = false;
      stopping = true;
      mainHandler.removeCallbacks(restartRunnable);
      cleanupRecognizer();
      emit("cancelled", stateJson());
      callbackContext.success(stateJson());
    });
  }

  private void createRecognizer(boolean preferOnDevice) {
    if (recognizer != null) return;

    Context context = cordova.getContext();
    if (
      preferOnDevice &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    ) {
      recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
    } else {
      recognizer = SpeechRecognizer.createSpeechRecognizer(context);
    }
    recognizer.setRecognitionListener(listener);
  }

  private Intent buildIntent(JSONObject options) {
    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
    intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);
    intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, Math.max(1, Math.min(10, options.optInt("maxResults", 1))));
    intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, cordova.getContext().getPackageName());

    String language = options.optString("language", "").trim();
    if (!language.isEmpty()) {
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
    } else {
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
    }

    if (options.optBoolean("preferOffline", false)) {
      intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
    }

    long silence = options.optLong("silenceLengthMillis", 0L);
    if (silence > 0L) {
      intent.putExtra(
        RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
        silence
      );
    }

    return intent;
  }

  private final RecognitionListener listener = new RecognitionListener() {
    @Override
    public void onReadyForSpeech(Bundle params) {
      emit("ready", null);
    }

    @Override
    public void onBeginningOfSpeech() {
      emit("speechstart", null);
    }

    @Override
    public void onRmsChanged(float rmsdB) {
      long now = System.currentTimeMillis();
      if (now - lastRmsAt < RMS_THROTTLE_MS) return;
      lastRmsAt = now;

      JSONObject payload = new JSONObject();
      put(payload, "rms", rmsdB);
      emit("volume", payload);
    }

    @Override
    public void onBufferReceived(byte[] buffer) {
      // Raw audio is intentionally not forwarded to JavaScript.
    }

    @Override
    public void onEndOfSpeech() {
      emit("speechend", null);
    }

    @Override
    public void onError(int error) {
      handleError(error);
    }

    @Override
    public void onResults(Bundle results) {
      handleResults(results);
    }

    @Override
    public void onPartialResults(Bundle partialResultsBundle) {
      handlePartialResults(partialResultsBundle);
    }

    @Override
    public void onEvent(int eventType, Bundle params) {
      JSONObject payload = new JSONObject();
      put(payload, "type", eventType);
      emit("event", payload);
    }
  };

  private void handleResults(Bundle results) {
    JSONObject payload = resultPayload(results, true);
    emit("result", payload);

    if (stopCallback != null) {
      stopCallback.success(payload);
      stopCallback = null;
    }

    boolean shouldRestart = continuous && !stopping;
    if (shouldRestart) {
      scheduleRestart();
    } else {
      cleanupRecognizer();
      emit("end", stateJson());
    }
  }

  private void handlePartialResults(Bundle results) {
    if (!partialResults) return;
    emit("partial", resultPayload(results, false));
  }

  private void handleError(int error) {
    String code = errorCode(error);
    JSONObject payload = errorJson(code, errorMessage(error));
    put(payload, "recoverable", isRecoverable(error));
    emit("error", payload);

    if (stopCallback != null) {
      stopCallback.error(payload);
      stopCallback = null;
    }

    boolean shouldRestart = continuous && !stopping && isRecoverable(error);
    if (shouldRestart) {
      scheduleRestart();
    } else {
      cleanupRecognizer();
      emit("end", stateJson());
    }
  }

  private void scheduleRestart() {
    mainHandler.removeCallbacks(restartRunnable);
    mainHandler.postDelayed(restartRunnable, RESTART_DELAY_MS);
  }

  private void restartRecognition() {
    if (!continuous || stopping || !listening || lastIntent == null) return;

    try {
      if (recognizer == null) createRecognizer(false);
      recognizer.startListening(lastIntent);
      emit("restart", stateJson());
    } catch (Exception error) {
      emit("error", errorJson("restart_failed", safeMessage(error)));
      cleanupRecognizer();
      emit("end", stateJson());
    }
  }

  private JSONObject resultPayload(Bundle bundle, boolean isFinal) {
    ArrayList<String> matches = bundle != null
      ? bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
      : null;

    JSONObject payload = new JSONObject();
    put(payload, "text", matches != null && !matches.isEmpty() ? matches.get(0) : "");
    put(payload, "alternatives", toJsonArray(matches));
    put(payload, "isFinal", isFinal);

    if (isFinal && bundle != null) {
      float[] scores = bundle.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
      JSONArray confidences = new JSONArray();
      if (scores != null) {
        for (float score : scores) confidences.put((double) score);
      }
      put(payload, "confidences", confidences);
    }

    return payload;
  }

  private void cleanupRecognizer() {
    mainHandler.removeCallbacks(restartRunnable);
    mainHandler.removeCallbacks(stopTimeoutRunnable);

    SpeechRecognizer current = recognizer;
    recognizer = null;
    if (current != null) {
      try {
        current.setRecognitionListener(null);
      } catch (Exception ignored) {
        // The recognizer may already be released.
      }
      try {
        current.cancel();
      } catch (Exception ignored) {
        // The recognizer may already be released.
      }
      try {
        current.destroy();
      } catch (Exception ignored) {
        // The recognizer may already be released.
      }
    }

    listening = false;
    stopping = false;
    continuous = false;
    lastIntent = null;
    lastRmsAt = 0L;

    if (startCallback != null) {
      startCallback.error(errorJson("cancelled", "Voice recognition was cancelled."));
      startCallback = null;
    }
    if (stopCallback != null) {
      stopCallback.success(stateJson());
      stopCallback = null;
    }
  }

  private void clearPendingStart() {
    pendingStartCallback = null;
    pendingStartOptions = null;
  }

  @Override
  public void onRequestPermissionResult(int requestCode, String[] permissions, int[] grantResults) {
    if (requestCode != REQUEST_RECORD_AUDIO) return;

    boolean granted = false;
    if (grantResults != null && grantResults.length > 0) {
      granted = grantResults[0] == PackageManager.PERMISSION_GRANTED;
    }

    if (permissionCallback != null) {
      permissionCallback.success(granted ? 1 : 0);
      permissionCallback = null;
    }

    if (pendingStartCallback != null) {
      CallbackContext callback = pendingStartCallback;
      JSONObject options = pendingStartOptions;
      clearPendingStart();

      if (granted) {
        startRecognition(options, callback);
      } else {
        callback.error(errorJson("permission_denied", "Microphone permission was denied."));
      }
    }
  }

  @Override
  public void onReset() {
    mainHandler.post(this::cleanupRecognizer);
    eventCallback = null;
  }

  @Override
  public void onDestroy() {
    mainHandler.post(this::cleanupRecognizer);
    eventCallback = null;
    super.onDestroy();
  }

  private void emit(String event, JSONObject data) {
    if (eventCallback == null) return;

    JSONObject payload = data != null ? data : new JSONObject();
    put(payload, "event", event);

    PluginResult result = new PluginResult(PluginResult.Status.OK, payload);
    result.setKeepCallback(true);
    eventCallback.sendPluginResult(result);
  }

  private JSONObject stateJson() {
    JSONObject state = new JSONObject();
    put(state, "listening", listening);
    put(state, "continuous", continuous);
    return state;
  }

  private static JSONArray toJsonArray(ArrayList<String> values) {
    JSONArray array = new JSONArray();
    if (values != null) {
      for (String value : values) array.put(value != null ? value : "");
    }
    return array;
  }

  private static JSONObject errorJson(String code, String message) {
    JSONObject payload = new JSONObject();
    put(payload, "code", code);
    put(payload, "message", message);
    return payload;
  }

  private static void put(JSONObject object, String key, Object value) {
    try {
      object.put(key, value);
    } catch (JSONException ignored) {
      // Values used here are always JSON-safe.
    }
  }

  private static String errorCode(int error) {
    switch (error) {
      case SpeechRecognizer.ERROR_AUDIO:
        return "audio";
      case SpeechRecognizer.ERROR_CLIENT:
        return "client";
      case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
        return "permission_denied";
      case SpeechRecognizer.ERROR_NETWORK:
        return "network";
      case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
        return "network_timeout";
      case SpeechRecognizer.ERROR_NO_MATCH:
        return "no_match";
      case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
        return "busy";
      case SpeechRecognizer.ERROR_SERVER:
        return "server";
      case SpeechRecognizer.ERROR_SERVER_DISCONNECTED:
        return "server_disconnected";
      case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
        return "speech_timeout";
      case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
        return "language_not_supported";
      case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
        return "language_unavailable";
      case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS:
        return "too_many_requests";
      case SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT:
        return "cannot_check_support";
      default:
        return "unknown";
    }
  }

  private static String errorMessage(int error) {
    switch (error) {
      case SpeechRecognizer.ERROR_AUDIO:
        return "Audio recording failed.";
      case SpeechRecognizer.ERROR_CLIENT:
        return "The speech recognizer stopped unexpectedly.";
      case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
        return "Microphone permission is required.";
      case SpeechRecognizer.ERROR_NETWORK:
        return "Speech recognition requires a network connection.";
      case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
        return "The speech recognition network request timed out.";
      case SpeechRecognizer.ERROR_NO_MATCH:
        return "No speech was recognized.";
      case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
        return "The speech recognizer is busy.";
      case SpeechRecognizer.ERROR_SERVER:
        return "The speech recognition server returned an error.";
      case SpeechRecognizer.ERROR_SERVER_DISCONNECTED:
        return "The speech recognition server disconnected.";
      case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
        return "No speech was detected.";
      case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
        return "The selected language is not supported.";
      case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
        return "The selected language is unavailable.";
      case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS:
        return "Too many speech recognition requests. Try again later.";
      case SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT:
        return "Speech recognition support could not be checked.";
      default:
        return "Speech recognition failed.";
    }
  }

  private static boolean isRecoverable(int error) {
    return (
      error == SpeechRecognizer.ERROR_NO_MATCH ||
      error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ||
      error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ||
      error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED
    );
  }

  private static String safeMessage(Exception error) {
    String message = error.getMessage();
    return message != null && !message.isEmpty() ? message : error.getClass().getSimpleName();
  }
}
