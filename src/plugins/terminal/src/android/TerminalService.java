package com.foxdebug.acode.rk.exec.terminal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.os.PowerManager;
import android.os.RemoteException;
import androidx.core.app.NotificationCompat;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import com.foxdebug.acode.rk.exec.terminal.*;


public class TerminalService extends Service {

    public static final int MSG_START_PROCESS = 1;
    public static final int MSG_WRITE_TO_PROCESS = 2;
    public static final int MSG_STOP_PROCESS = 3;
    public static final int MSG_IS_RUNNING = 4;
    public static final int MSG_EXEC = 5;

    public static final String CHANNEL_ID = "terminal_exec_channel";
    
    public static final String ACTION_EXIT_SERVICE = "com.foxdebug.acode.ACTION_EXIT_SERVICE";
    public static final String MOVE_TO_BACKGROUND = "com.foxdebug.acode.MOVE_TO_BACKGROUND";
    public static final String MOVE_TO_FOREGROUND = "com.foxdebug.acode.MOVE_TO_FOREGROUND";
    public static final String ACTION_TOGGLE_WAKE_LOCK = "com.foxdebug.acode.ACTION_TOGGLE_WAKE_LOCK";
    public static boolean Default_Foreground = true;

    private final Map<String, Process> processes = new ConcurrentHashMap<>();
    private final Map<String, OutputStream> processInputs = new ConcurrentHashMap<>();
    private final Map<String, Messenger> clientMessengers = new ConcurrentHashMap<>();
    private final java.util.concurrent.ExecutorService threadPool = Executors.newCachedThreadPool();

    private final Messenger serviceMessenger = new Messenger(new ServiceHandler());
    
    private PowerManager.WakeLock wakeLock;
    private boolean isWakeLockHeld = false;
    private ProcessManager processManager;

    @Override
    public void onCreate() {
        super.onCreate();
        processManager = new ProcessManager(this);
        if(Default_Foreground){
            createNotificationChannel();
            updateNotification();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return serviceMessenger.getBinder();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_EXIT_SERVICE.equals(action)) {
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            } else if (ACTION_TOGGLE_WAKE_LOCK.equals(action)) {
                toggleWakeLock();
            } else if(MOVE_TO_BACKGROUND.equals(action)){
                Default_Foreground = false;
                stopForeground(true);
            } else if(MOVE_TO_FOREGROUND.equals(action)){
                Default_Foreground = true;
                createNotificationChannel();
                updateNotification();
            }
        }
        return START_STICKY;
    }

    private class ServiceHandler extends Handler {
        @Override
        public void handleMessage(Message msg) {
            Bundle bundle = msg.getData();
            String id = bundle.getString("id");
            Messenger clientMessenger = msg.replyTo;

            switch (msg.what) {
                case MSG_START_PROCESS:
                    String cmd = bundle.getString("cmd");
                    String alpine = bundle.getString("alpine");
                    clientMessengers.put(id, clientMessenger);
                    startProcess(id, cmd, "true".equals(alpine));
                    break;
                case MSG_WRITE_TO_PROCESS:
                    String input = bundle.getString("input");
                    writeToProcess(id, input);
                    break;
                case MSG_STOP_PROCESS:
                    stopProcess(id);
                    break;
                case MSG_IS_RUNNING:
                    isProcessRunning(id, clientMessenger);
                    break;
                case MSG_EXEC:
                    String execCmd = bundle.getString("cmd");
                    String execAlpine = bundle.getString("alpine");
                    clientMessengers.put(id, clientMessenger);
                    exec(id, execCmd, "true".equals(execAlpine));
                    break;
            }
        }
    }

    private void toggleWakeLock() {
        if (isWakeLockHeld) {
            releaseWakeLock();
        } else {
            acquireWakeLock();
        }
        updateNotification();
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AcodeTerminal:WakeLock");
        }
        
        if (!isWakeLockHeld) {
            wakeLock.acquire();
            isWakeLockHeld = true;
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && isWakeLockHeld) {
            wakeLock.release();
            isWakeLockHeld = false;
        }
    }

    private void startProcess(String pid, String cmd, boolean useAlpine) {
        threadPool.execute(() -> {
            try {
                ProcessBuilder builder = processManager.createProcessBuilder(cmd, useAlpine);
                Process process = builder.start();
                
                processes.put(pid, process);
                processInputs.put(pid, process.getOutputStream());
                
                // Stream stdout
                threadPool.execute(() -> 
                    StreamHandler.streamOutput(process.getInputStream(), 
                        line -> sendMessageToClient(pid, "stdout", line))
                );
                
                // Stream stderr
                threadPool.execute(() -> 
                    StreamHandler.streamOutput(process.getErrorStream(), 
                        line -> sendMessageToClient(pid, "stderr", line))
                );
                
                // Wait for process completion
                threadPool.execute(() -> {
                    try {
                        int exitCode = process.waitFor();
                        sendMessageToClient(pid, "exit", String.valueOf(exitCode));
                        cleanup(pid);
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }
                });
            } catch (IOException e) {
                e.printStackTrace();
                sendMessageToClient(pid, "stderr", "Failed to start process: " + e.getMessage());
                sendMessageToClient(pid, "exit", "1");
                cleanup(pid);
            }
        });
    }

    private void exec(String execId, String cmd, boolean useAlpine) {
        threadPool.execute(() -> {
            try {
                ProcessManager.ExecResult result = processManager.executeCommand(cmd, useAlpine);
                
                if (result.isSuccess()) {
                    sendExecResultToClient(execId, true, result.stdout);
                } else {
                    sendExecResultToClient(execId, false, result.getErrorMessage());
                }
                
                cleanup(execId);
            } catch (Exception e) {
                sendExecResultToClient(execId, false, "Exception: " + e.getMessage());
                cleanup(execId);
            }
        });
    }

    private void sendMessageToClient(String id, String action, String data) {
        Messenger clientMessenger = clientMessengers.get(id);
        if (clientMessenger != null) {
            try {
                Message msg = Message.obtain();
                Bundle bundle = new Bundle();
                bundle.putString("id", id);
                bundle.putString("action", action);
                bundle.putString("data", data);
                msg.setData(bundle);
                clientMessenger.send(msg);
            } catch (RemoteException e) {
                cleanup(id);
            }
        }
    }

    private void sendExecResultToClient(String id, boolean isSuccess, String data) {
        Messenger clientMessenger = clientMessengers.get(id);
        if (clientMessenger != null) {
            try {
                Message msg = Message.obtain();
                Bundle bundle = new Bundle();
                bundle.putString("id", id);
                bundle.putString("action", "exec_result");
                bundle.putString("data", data);
                bundle.putBoolean("isSuccess", isSuccess);
                msg.setData(bundle);
                clientMessenger.send(msg);
            } catch (RemoteException e) {
                cleanup(id);
            }
        }
    }

    private void writeToProcess(String pid, String input) {
        try {
            OutputStream os = processInputs.get(pid);
            if (os != null) {
                StreamHandler.writeToStream(os, input);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private void stopProcess(String pid) {
        Process process = processes.get(pid);
        if (process != null) {
            ProcessUtils.killProcessTree(process);
            cleanup(pid);
        }
    }

    private void isProcessRunning(String pid, Messenger clientMessenger) {
        Process process = processes.get(pid);
        String status = process != null && ProcessUtils.isAlive(process) ? "running" : "not_found";
        sendMessageToClient(pid, "isRunning", status);
    }

    private void cleanup(String id) {
        processes.remove(id);
        processInputs.remove(id);
        clientMessengers.remove(id);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Terminal Executor Channel",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }

    private void updateNotification() {
        Intent exitIntent = new Intent(this, TerminalService.class);
        exitIntent.setAction(ACTION_EXIT_SERVICE);
        PendingIntent exitPendingIntent = PendingIntent.getService(this, 0, exitIntent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent wakeLockIntent = new Intent(this, TerminalService.class);
        wakeLockIntent.setAction(ACTION_TOGGLE_WAKE_LOCK);
        PendingIntent wakeLockPendingIntent = PendingIntent.getService(this, 1, wakeLockIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String contentText = "Executor service" + (isWakeLockHeld ? " (wakelock held)" : "");
        String wakeLockButtonText = isWakeLockHeld ? "Release Wake Lock" : "Acquire Wake Lock";

        int notificationIcon = resolveDrawableId("ic_notification", "ic_launcher_foreground", "ic_launcher");

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Acode Service")
                .setContentText(contentText)
                .setSmallIcon(notificationIcon)
                .setOngoing(true)
                .addAction(notificationIcon, wakeLockButtonText, wakeLockPendingIntent)
                .addAction(notificationIcon, "Exit", exitPendingIntent)
                .build();

        startForeground(1, notification);
    }

    @Override
    public void onDestroy() {
        stopForeground(true);
        super.onDestroy();
        releaseWakeLock();
        
        for (Process process : processes.values()) {
            ProcessUtils.killProcessTree(process);
        }

        processes.clear();
        processInputs.clear();
        clientMessengers.clear();
        threadPool.shutdown();
    }

    private int resolveDrawableId(String... names) {
        for (String name : names) {
            int id = getResources().getIdentifier(name, "drawable", getPackageName());
            if (id != 0) return id;
        }
        return android.R.drawable.sym_def_app_icon;
    }
}