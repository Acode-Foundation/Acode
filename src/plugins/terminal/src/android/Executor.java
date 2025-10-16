package com.foxdebug.acode.rk.exec.terminal;

import org.apache.cordova.*;
import org.json.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import android.util.Log;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.app.Activity;

public class Executor extends CordovaPlugin {

    private Messenger serviceMessenger;
    private boolean isServiceBound;
    private boolean isServiceBinding; // Track if binding is in progress
    private Context context;
    private Activity activity;
    private final Messenger handlerMessenger = new Messenger(new IncomingHandler());
    private CountDownLatch serviceConnectedLatch;
    private final java.util.Map<String, CallbackContext> callbackContextMap = new java.util.concurrent.ConcurrentHashMap<>();

    private static final int REQUEST_POST_NOTIFICATIONS = 1001;
    
    private void askNotificationPermission(Activity context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    context, Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED) {
            } else if (ActivityCompat.shouldShowRequestPermissionRationale(
                    context, Manifest.permission.POST_NOTIFICATIONS)) {
                ActivityCompat.requestPermissions(
                        context,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQUEST_POST_NOTIFICATIONS
                );
            } else {
                ActivityCompat.requestPermissions(
                        context,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQUEST_POST_NOTIFICATIONS
                );
            }
        }
    }

    @Override
    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        this.context = cordova.getContext();
        this.activity = cordova.getActivity();
        askNotificationPermission(activity);
        
        // Don't bind service immediately - wait until needed
        Log.d("Executor", "Plugin initialized - service will be started when needed");
    }

    /**
     * Ensure service is bound and ready for communication
     * Returns true if service is ready, false if binding failed
     */
    private boolean ensureServiceBound(CallbackContext callbackContext) {
        // If already bound, return immediately
        if (isServiceBound && serviceMessenger != null) {
            return true;
        }

        // If binding is already in progress, wait for it
        if (isServiceBinding) {
            try {
                if (serviceConnectedLatch != null && 
                    serviceConnectedLatch.await(10, TimeUnit.SECONDS)) {
                    return isServiceBound;
                } else {
                    callbackContext.error("Service binding timeout");
                    return false;
                }
            } catch (InterruptedException e) {
                callbackContext.error("Service binding interrupted: " + e.getMessage());
                return false;
            }
        }

        // Start binding process
        Log.d("Executor", "Starting service binding...");
        return bindServiceNow(callbackContext);
    }

    /**
     * Immediately bind to service
     */
    private boolean bindServiceNow(CallbackContext callbackContext) {
        if (isServiceBinding) {
            return false; // Already binding
        }

        isServiceBinding = true;
        serviceConnectedLatch = new CountDownLatch(1);

        Intent intent = new Intent(context, TerminalService.class);
        
        // Start the service first
        context.startService(intent);
        
        // Then bind to it
        boolean bindResult = context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        
        if (!bindResult) {
            Log.e("Executor", "Failed to bind to service");
            isServiceBinding = false;
            callbackContext.error("Failed to bind to service");
            return false;
        }

        // Wait for connection
        try {
            if (serviceConnectedLatch.await(10, TimeUnit.SECONDS)) {
                Log.d("Executor", "Service bound successfully");
                return isServiceBound;
            } else {
                Log.e("Executor", "Service binding timeout");
                callbackContext.error("Service binding timeout");
                isServiceBinding = false;
                return false;
            }
        } catch (InterruptedException e) {
            Log.e("Executor", "Service binding interrupted: " + e.getMessage());
            callbackContext.error("Service binding interrupted: " + e.getMessage());
            isServiceBinding = false;
            return false;
        }
    }

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            Log.d("Executor", "Service connected");
            serviceMessenger = new Messenger(service);
            isServiceBound = true;
            isServiceBinding = false;
            if (serviceConnectedLatch != null) {
                serviceConnectedLatch.countDown();
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            Log.w("Executor", "Service disconnected");
            serviceMessenger = null;
            isServiceBound = false;
            isServiceBinding = false;
            serviceConnectedLatch = new CountDownLatch(1);
        }
    };

    private class IncomingHandler extends Handler {
        @Override
        public void handleMessage(Message msg) {
            Bundle bundle = msg.getData();
            String id = bundle.getString("id");
            String action = bundle.getString("action");
            String data = bundle.getString("data");

            if (action.equals("exec_result")) {
                CallbackContext callbackContext = getCallbackContext(id);
                if (callbackContext != null) {
                    if (bundle.getBoolean("isSuccess", false)) {
                        callbackContext.success(data);
                    } else {
                        callbackContext.error(data);
                    }
                    cleanupCallback(id);
                }
            } else {
                String pid = id;
                CallbackContext callbackContext = getCallbackContext(pid);

                if (callbackContext != null) {
                    switch (action) {
                        case "stdout":
                        case "stderr":
                            PluginResult result = new PluginResult(PluginResult.Status.OK, action + ":" + data);
                            result.setKeepCallback(true);
                            callbackContext.sendPluginResult(result);
                            break;
                        case "exit":
                            cleanupCallback(pid);
                            callbackContext.success("exit:" + data);
                            break;
                        case "isRunning":
                            callbackContext.success(data);
                            cleanupCallback(pid);
                            break;
                    }
                }
            }
        }
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        // For actions that don't need the service, handle them directly
        if (action.equals("loadLibrary")) {
            try {
                System.load(args.getString(0));
                callbackContext.success("Library loaded successfully.");
            } catch (Exception e) {
                callbackContext.error("Failed to load library: " + e.getMessage());
            }
            return true;
        }

        if (action.equals("stopService")) {
            stopServiceNow();
            callbackContext.success("Service stopped");
            return true;
        }

        // For all other actions, ensure service is bound first
        if (!ensureServiceBound(callbackContext)) {
            // Error already sent by ensureServiceBound
            return false;
        }

        switch (action) {
            case "start":
                String cmdStart = args.getString(0);
                String pid = UUID.randomUUID().toString();
                callbackContextMap.put(pid, callbackContext);
                startProcess(pid, cmdStart, args.getString(1));
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
                String execId = UUID.randomUUID().toString();
                callbackContextMap.put(execId, callbackContext);
                exec(execId, args.getString(0), args.getString(1));
                return true;
            case "isRunning":
                String pidCheck = args.getString(0);
                callbackContextMap.put(pidCheck, callbackContext);
                isProcessRunning(pidCheck);
                return true;
            default:
                callbackContext.error("Unknown action: " + action);
                return false;
        }
    }

    private void stopServiceNow() {
        if (isServiceBound) {
            try {
                context.unbindService(serviceConnection);
                Log.d("Executor", "Service unbound");
            } catch (IllegalArgumentException ignored) {
                // already unbound
            }
            isServiceBound = false;
        }
        isServiceBinding = false;

        Intent intent = new Intent(context, TerminalService.class);
        boolean stopped = context.stopService(intent);
        Log.d("Executor", "Service stop result: " + stopped);
        
        serviceMessenger = null;
        if (serviceConnectedLatch == null) {
            serviceConnectedLatch = new CountDownLatch(1);
        }
    }

    private void startProcess(String pid, String cmd, String alpine) {
        CallbackContext callbackContext = getCallbackContext(pid);
        if (callbackContext != null) {
            PluginResult result = new PluginResult(PluginResult.Status.OK, pid);
            result.setKeepCallback(true);
            callbackContext.sendPluginResult(result);
        }

        Message msg = Message.obtain(null, TerminalService.MSG_START_PROCESS);
        msg.replyTo = handlerMessenger;
        Bundle bundle = new Bundle();
        bundle.putString("id", pid);
        bundle.putString("cmd", cmd);
        bundle.putString("alpine", alpine);
        msg.setData(bundle);
        try {
            serviceMessenger.send(msg);
        } catch (RemoteException e) {
            CallbackContext errorContext = getCallbackContext(pid);
            if (errorContext != null) {
                errorContext.error("Failed to start process: " + e.getMessage());
                cleanupCallback(pid);
            }
        }
    }

    private void exec(String execId, String cmd, String alpine) {
        Message msg = Message.obtain(null, TerminalService.MSG_EXEC);
        msg.replyTo = handlerMessenger;
        Bundle bundle = new Bundle();
        bundle.putString("id", execId);
        bundle.putString("cmd", cmd);
        bundle.putString("alpine", alpine);
        msg.setData(bundle);
        try {
            serviceMessenger.send(msg);
        } catch (RemoteException e) {
            CallbackContext callbackContext = getCallbackContext(execId);
            if (callbackContext != null) {
                callbackContext.error("Failed to execute command: " + e.getMessage());
                cleanupCallback(execId);
            }
        }
    }

    private void writeToProcess(String pid, String input, CallbackContext callbackContext) {
        Message msg = Message.obtain(null, TerminalService.MSG_WRITE_TO_PROCESS);
        Bundle bundle = new Bundle();
        bundle.putString("id", pid);
        bundle.putString("input", input);
        msg.setData(bundle);
        try {
            serviceMessenger.send(msg);
            callbackContext.success("Written to process");
        } catch (RemoteException e) {
            callbackContext.error("Write error: " + e.getMessage());
        }
    }

    private void stopProcess(String pid, CallbackContext callbackContext) {
        Message msg = Message.obtain(null, TerminalService.MSG_STOP_PROCESS);
        Bundle bundle = new Bundle();
        bundle.putString("id", pid);
        msg.setData(bundle);
        try {
            serviceMessenger.send(msg);
            callbackContext.success("Process terminated");
        } catch (RemoteException e) {
            callbackContext.error("Stop error: " + e.getMessage());
        }
    }

    private void isProcessRunning(String pid) {
        Message msg = Message.obtain(null, TerminalService.MSG_IS_RUNNING);
        msg.replyTo = handlerMessenger;
        Bundle bundle = new Bundle();
        bundle.putString("id", pid);
        msg.setData(bundle);
        try {
            serviceMessenger.send(msg);
        } catch (RemoteException e) {
            CallbackContext callbackContext = getCallbackContext(pid);
            if (callbackContext != null) {
                callbackContext.error("Check running error: " + e.getMessage());
                cleanupCallback(pid);
            }
        }
    }

    private CallbackContext getCallbackContext(String id) {
        return callbackContextMap.get(id);
    }

    private void cleanupCallback(String id) {
        callbackContextMap.remove(id);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
    }
}