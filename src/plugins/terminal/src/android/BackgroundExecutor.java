package com.foxdebug.acode.rk.exec.terminal;

import org.apache.cordova.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import com.foxdebug.acode.rk.exec.terminal.*;

public class BackgroundExecutor extends CordovaPlugin {

    private final Map<String, Process> processes = new ConcurrentHashMap<>();
    private final Map<String, OutputStream> processInputs = new ConcurrentHashMap<>();
    private final Map<String, CallbackContext> processCallbacks = new ConcurrentHashMap<>();
    private ProcessManager processManager;

    @Override
    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        this.processManager = new ProcessManager(cordova.getContext());
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        switch (action) {
            case "start":
                String pid = UUID.randomUUID().toString();
                startProcess(pid, args.getString(0), args.getString(1).equals("true"), callbackContext);
                return true;
            case "write":
                writeToProcess(args.getString(0), args.getString(1), callbackContext);
                return true;
            case "stop":
                stopProcess(args.getString(0), callbackContext);
                return true;
            case "exec":
                exec(args.getString(0), args.getString(1).equals("true"), callbackContext);
                return true;
            case "isRunning":
                isProcessRunning(args.getString(0), callbackContext);
                return true;
            case "loadLibrary":
                loadLibrary(args.getString(0), callbackContext);
                return true;
            default:
                callbackContext.error("Unknown action: " + action);
                return false;
        }
    }

    private void exec(String cmd, boolean useAlpine, CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            try {
                ProcessManager.ExecResult result = processManager.executeCommand(cmd, useAlpine);
                
                if (result.isSuccess()) {
                    callbackContext.success(result.stdout);
                } else {
                    callbackContext.error(result.getErrorMessage());
                }
            } catch (Exception e) {
                callbackContext.error("Exception: " + e.getMessage());
            }
        });
    }

    private void startProcess(String pid, String cmd, boolean useAlpine, CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            try {
                ProcessBuilder builder = processManager.createProcessBuilder(cmd, useAlpine);
                Process process = builder.start();

                processes.put(pid, process);
                processInputs.put(pid, process.getOutputStream());
                processCallbacks.put(pid, callbackContext);

                sendPluginResult(callbackContext, pid, true);

                // Stream stdout
                new Thread(() -> StreamHandler.streamOutput(
                    process.getInputStream(), 
                    line -> sendPluginMessage(pid, "stdout:" + line)
                )).start();
                
                // Stream stderr
                new Thread(() -> StreamHandler.streamOutput(
                    process.getErrorStream(), 
                    line -> sendPluginMessage(pid, "stderr:" + line)
                )).start();

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
                StreamHandler.writeToStream(os, input);
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
            ProcessUtils.killProcessTree(process);
            cleanup(pid);
            callbackContext.success("Process terminated");
        } else {
            callbackContext.error("No such process");
        }
    }

    private void isProcessRunning(String pid, CallbackContext callbackContext) {
        Process process = processes.get(pid);
        
        if (process != null) {
            String status = ProcessUtils.isAlive(process) ? "running" : "exited";
            if (status.equals("exited")) cleanup(pid);
            callbackContext.success(status);
        } else {
            callbackContext.success("not_found");
        }
    }

    private void loadLibrary(String path, CallbackContext callbackContext) {
        try {
            System.load(path);
            callbackContext.success("Library loaded successfully.");
        } catch (Exception e) {
            callbackContext.error("Failed to load library: " + e.getMessage());
        }
    }

    private void sendPluginResult(CallbackContext ctx, String message, boolean keepCallback) {
        PluginResult result = new PluginResult(PluginResult.Status.OK, message);
        result.setKeepCallback(keepCallback);
        ctx.sendPluginResult(result);
    }

    private void sendPluginMessage(String pid, String message) {
        CallbackContext ctx = processCallbacks.get(pid);
        if (ctx != null) {
            sendPluginResult(ctx, message, true);
        }
    }

    private void cleanup(String pid) {
        processes.remove(pid);
        processInputs.remove(pid);
        processCallbacks.remove(pid);
    }
}