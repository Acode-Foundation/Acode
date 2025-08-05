package com.foxdebug.acode.rk.exec.terminal;

import org.apache.cordova.*;
import org.json.*;

import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import android.content.Context;
import android.app.Activity;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;

public class Executor extends CordovaPlugin {

    private final Map<String, Process> processes = new ConcurrentHashMap<>();
    private final Map<String, OutputStream> processInputs = new ConcurrentHashMap<>();
    private final Map<String, CallbackContext> processCallbacks = new ConcurrentHashMap<>();

    private Context context;


  @Override
  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    this.context = cordova.getContext();
   
  }

  


    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        switch (action) {
            case "start":
                String cmdStart = args.getString(0);
                String pid = UUID.randomUUID().toString();
                startProcess(pid, cmdStart,args.getString(1), callbackContext);
                return true;
            case "write":
                String pidWrite = args.getString(0);
                String input = args.getString(1);
                writeToProcess(pidWrite, input, callbackContext);
                return true;
            case "stop":
                String pidStop = args.getString(0);
                stopProcess(pidStop, callbackContext);
                return true;
            case "exec":
                exec(args.getString(0),args.getString(1), callbackContext);
                return true;
            case "isRunning":
                isProcessRunning(args.getString(0), callbackContext);
                return true;
            case "loadLibrary":
                try {
                    System.load(args.getString(0));
                    callbackContext.success("Library loaded successfully.");
                } catch (Exception e) {
                    callbackContext.error("Failed to load library: " + e.getMessage());
                }
                return true;
            default:
                callbackContext.error("Unknown action: " + action);
                return false;
        }
    }

    private void exec(String cmd,String alpine, CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
        try {
            if (cmd != null && !cmd.isEmpty()) {
                String xcmd = cmd;
                if(alpine.equals("true")){
                    xcmd = "source $PREFIX/init-sandbox.sh "+cmd;
                }
                
                ProcessBuilder builder = new ProcessBuilder("sh", "-c", xcmd);

                // Set environment variables
                Map<String, String> env = builder.environment();
                env.put("PREFIX", context.getFilesDir().getAbsolutePath());
                env.put("NATIVE_DIR", context.getApplicationInfo().nativeLibraryDir);

                try {
                    int target = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).applicationInfo.targetSdkVersion;
                    env.put("FDROID", String.valueOf(target <= 28));
                } catch (PackageManager.NameNotFoundException e) {
                    e.printStackTrace();
                }


                Process process = builder.start();

                // Capture stdout
                BufferedReader stdOutReader = new BufferedReader(
                        new InputStreamReader(process.getInputStream()));
                StringBuilder stdOut = new StringBuilder();
                String line;
                while ((line = stdOutReader.readLine()) != null) {
                    stdOut.append(line).append("\n");
                }

                // Capture stderr
                BufferedReader stdErrReader = new BufferedReader(
                        new InputStreamReader(process.getErrorStream()));
                StringBuilder stdErr = new StringBuilder();
                while ((line = stdErrReader.readLine()) != null) {
                    stdErr.append(line).append("\n");
                }

                int exitCode = process.waitFor();
                if (exitCode == 0) {
                    callbackContext.success(stdOut.toString().trim());
                } else {
                    String errorOutput = stdErr.toString().trim();
                    if (errorOutput.isEmpty()) {
                        errorOutput = "Command exited with code: " + exitCode;
                    }
                    callbackContext.error(errorOutput);
                }
            } else {
                callbackContext.error("Expected one non-empty string argument.");
            }
        } catch (Exception e) {
            e.printStackTrace();
            callbackContext.error("Exception: " + e.getMessage());
        }
        });
    }

    private void startProcess(String pid, String cmd,String alpine, CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            try {
                String xcmd = cmd;
                if(alpine.equals("true")){
                    xcmd = "source $PREFIX/init-sandbox.sh "+cmd;
                }
                ProcessBuilder builder = new ProcessBuilder("sh", "-c", xcmd);

                // Set environment variables
                Map<String, String> env = builder.environment();
                env.put("PREFIX", context.getFilesDir().getAbsolutePath());
                env.put("NATIVE_DIR", context.getApplicationInfo().nativeLibraryDir);

                try {
                    int target = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).applicationInfo.targetSdkVersion;
                    env.put("FDROID", String.valueOf(target <= 28));
                } catch (PackageManager.NameNotFoundException e) {
                    e.printStackTrace();
                }



                Process process = builder.start();

                processes.put(pid, process);
                processInputs.put(pid, process.getOutputStream());
                processCallbacks.put(pid, callbackContext);

                PluginResult pluginResult = new PluginResult(PluginResult.Status.OK, pid);
                pluginResult.setKeepCallback(true);
                callbackContext.sendPluginResult(pluginResult);

                // stdout thread
                new Thread(() -> streamOutput(process.getInputStream(), pid, "stdout")).start();
                // stderr thread
                new Thread(() -> streamOutput(process.getErrorStream(), pid, "stderr")).start();

                int exitCode = process.waitFor();
                sendPluginMessage(pid, "exit:" + exitCode);
                cleanup(pid);
            } catch (Exception e) {
                callbackContext.error("Failed to start process: " + e.getMessage());
            }
        });
    }

    private void writeToProcess(String pid, String input, CallbackContext callbackContext) {
        try {
            OutputStream os = processInputs.get(pid);
            if (os != null) {
                os.write((input + "\n").getBytes());
                os.flush();
                callbackContext.success("Written to process");
            } else {
                callbackContext.error("Process not found or closed");
            }
        } catch (IOException e) {
            callbackContext.error("Write error: " + e.getMessage());
        }
    }

    private void stopProcess(String pid, CallbackContext callbackContext) {
        Process process = processes.get(pid);
        if (process != null) {
            process.destroy();
            cleanup(pid);
            callbackContext.success("Process terminated");
        } else {
            callbackContext.error("No such process");
        }
    }

    private void isProcessRunning(String pid, CallbackContext callbackContext) {
        Process process = processes.get(pid);

        if (process != null) {
            if (process.isAlive()) {
                callbackContext.success("running");
            } else {
                cleanup(pid);
                callbackContext.success("exited");
            }
        } else {
            callbackContext.success("not_found");
        }
    }


    private void streamOutput(InputStream inputStream, String pid, String streamType) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sendPluginMessage(pid, streamType + ":" + line);
            }
        } catch (IOException ignored) {
        }
    }

    private void sendPluginMessage(String pid, String message) {
        CallbackContext ctx = processCallbacks.get(pid);
        if (ctx != null) {
            PluginResult result = new PluginResult(PluginResult.Status.OK, message);
            result.setKeepCallback(true);
            ctx.sendPluginResult(result);
        }
    }

    private void cleanup(String pid) {
        processes.remove(pid);
        processInputs.remove(pid);
        processCallbacks.remove(pid);
    }
}
