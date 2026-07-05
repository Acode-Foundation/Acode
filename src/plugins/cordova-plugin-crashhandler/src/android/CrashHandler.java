package com.foxdebug.crashhandler;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import java.io.PrintWriter;
import java.io.StringWriter;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;

public class CrashHandler extends CordovaPlugin {

  private static final String TAG = "CrashHandler";

  @Override
  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    Log.d(TAG, "Initializing CrashHandler...");

    Thread.setDefaultUncaughtExceptionHandler(
      new Thread.UncaughtExceptionHandler() {
        @Override
        public void uncaughtException(Thread thread, Throwable ex) {
          try {
            Log.e(TAG, "Uncaught native exception detected!", ex);

            StringWriter sw = new StringWriter();
            PrintWriter pw = new PrintWriter(sw);
            ex.printStackTrace(pw);
            String stackTrace = sw.toString();

            Context context = cordova.getActivity().getApplicationContext();
            Intent intent = new Intent(context, CrashActivity.class);
            intent.putExtra("error_type", "Native Crash");
            intent.putExtra(
              "error_message",
              ex.getMessage() != null ? ex.getMessage() : ex.toString()
            );
            intent.putExtra("stack_trace", stackTrace);
            intent.addFlags(
              Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK
            );
            context.startActivity(intent);
          } catch (Exception e) {
            Log.e(TAG, "Failed to launch CrashActivity", e);
          } finally {
            //Should we terminate the app? or let it run with faulty state?
            android.os.Process.killProcess(android.os.Process.myPid());
            System.exit(10);
          }
        }
      }
    );
  }
}
