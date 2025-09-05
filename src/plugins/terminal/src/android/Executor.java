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
//import com.foxdebug.acode.rk.exec.terminal.TerminalService;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.app.Activity;

public class Executor extends CordovaPlugin {

    private Messenger serviceMessenger;
    private boolean isServiceBound;
    private Context context;
    private Activity activity;
    private final Messenger handlerMessenger = new Messenger(new IncomingHandler());
    private CountDownLatch serviceConnectedLatch = new CountDownLatch(1);
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
        bindService();
    }

    private void bindService() {
        Intent intent = new Intent(context, TerminalService.class);
        context.startService(intent);
        context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
    }

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            serviceMessenger = new Messenger(service);
            isServiceBound = true;
            serviceConnectedLatch.countDown();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            serviceMessenger = null;
            isServiceBound = false;
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
                            break;
                    }
                }
            }
        }
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        try {
            if (!isServiceBound && !serviceConnectedLatch.await(5, TimeUnit.SECONDS)) {
                callbackContext.error("Service not bound - timeout");
                return false;
            }
        } catch (InterruptedException e) {
            callbackContext.error("Service binding interrupted: " + e.getMessage());
            return false;
        }

        if (!isServiceBound) {
            callbackContext.error("Service not bound");
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
        if (isServiceBound) {
            context.unbindService(serviceConnection);
            isServiceBound = false;
        }
    }
}