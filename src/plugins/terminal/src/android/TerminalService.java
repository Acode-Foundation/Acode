package com.foxdebug.acode.rk.exec.terminal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import androidx.core.app.NotificationCompat;
import com.foxdebug.acode.R;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;

public class TerminalService extends Service {

    public static final int MSG_START_PROCESS = 1;
    public static final int MSG_WRITE_TO_PROCESS = 2;
    public static final int MSG_STOP_PROCESS = 3;
    public static final int MSG_IS_RUNNING = 4;
    public static final int MSG_EXEC = 5;

    public static final String CHANNEL_ID = "terminal_exec_channel";

    private final Map<String, Process> processes = new ConcurrentHashMap<>();
    private final Map<String, OutputStream> processInputs = new ConcurrentHashMap<>();
    private final Map<String, Messenger> clientMessengers = new ConcurrentHashMap<>();
    private final java.util.concurrent.ExecutorService threadPool = Executors.newCachedThreadPool();

    private final Messenger serviceMessenger = new Messenger(new ServiceHandler());

    @Override
    public IBinder onBind(Intent intent) {
        return serviceMessenger.getBinder();
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
                    startProcess(id, cmd, alpine);
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
                    exec(id, execCmd, execAlpine);
                    break;
            }
        }
    }

    private void startProcess(String pid, String cmd, String alpine) {
        threadPool.execute(() -> {
            try {
                String xcmd = alpine.equals("true") ? "source $PREFIX/init-sandbox.sh " + cmd : cmd;
                ProcessBuilder builder = new ProcessBuilder("sh", "-c", xcmd);

                // Set environment variables
                Map<String, String> env = builder.environment();
                env.put("PREFIX", getFilesDir().getAbsolutePath());
                env.put("NATIVE_DIR", getApplicationInfo().nativeLibraryDir);

                try {
                    int target = getPackageManager().getPackageInfo(getPackageName(), 0).applicationInfo.targetSdkVersion;
                    env.put("FDROID", String.valueOf(target <= 28));
                } catch (Exception e) {
                    e.printStackTrace();
                }

                Process process = builder.start();
                processes.put(pid, process);
                processInputs.put(pid, process.getOutputStream());

                // Stream stdout
                threadPool.execute(() -> streamOutput(process.getInputStream(), pid, "stdout"));

                // Stream stderr
                threadPool.execute(() -> streamOutput(process.getErrorStream(), pid, "stderr"));

                // Wait for process to complete
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

    private void exec(String execId, String cmd, String alpine) {
        threadPool.execute(() -> {
            try {
                String xcmd = alpine.equals("true") ? "source $PREFIX/init-sandbox.sh " + cmd : cmd;
                ProcessBuilder builder = new ProcessBuilder("sh", "-c", xcmd);

                // Set environment variables
                Map<String, String> env = builder.environment();
                env.put("PREFIX", getFilesDir().getAbsolutePath());
                env.put("NATIVE_DIR", getApplicationInfo().nativeLibraryDir);

                try {
                    int target = getPackageManager().getPackageInfo(getPackageName(), 0).applicationInfo.targetSdkVersion;
                    env.put("FDROID", String.valueOf(target <= 28));
                } catch (Exception e) {
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
                    sendExecResultToClient(execId, true, stdOut.toString().trim());
                } else {
                    String errorOutput = stdErr.toString().trim();
                    if (errorOutput.isEmpty()) {
                        errorOutput = "Command exited with code: " + exitCode;
                    }
                    sendExecResultToClient(execId, false, errorOutput);
                }

                cleanup(execId);
            } catch (Exception e) {
                sendExecResultToClient(execId, false, "Exception: " + e.getMessage());
                cleanup(execId);
            }
        });
    }

    private void streamOutput(InputStream inputStream, String pid, String streamType) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sendMessageToClient(pid, streamType, line);
            }
        } catch (IOException ignored) {
        }
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
                // Client is no longer available, clean up
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
                // Client is no longer available, clean up
                cleanup(id);
            }
        }
    }

    private void writeToProcess(String pid, String input) {
        try {
            OutputStream os = processInputs.get(pid);
            if (os != null) {
                os.write((input + "\n").getBytes());
                os.flush();
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private void stopProcess(String pid) {
        Process process = processes.get(pid);
        if (process != null) {
            process.destroy();
            cleanup(pid);
        }
    }

    private void isProcessRunning(String pid, Messenger clientMessenger) {
        Process process = processes.get(pid);
        String status = process != null && isProcessAlive(process) ? "running" : "not_found";
        sendMessageToClient(pid, "isRunning", status);
    }

    private boolean isProcessAlive(Process process) {
        try {
            process.exitValue();
            return false;
        } catch(IllegalThreadStateException e) {
            return true;
        }
    }

    private void cleanup(String id) {
        processes.remove(id);
        processInputs.remove(id);
        clientMessengers.remove(id);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Acode Service")
                .setContentText("Executor service")
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setOngoing(true)
                .build();
        startForeground(1, notification);
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

    @Override
    public void onDestroy() {
        super.onDestroy();
        // Clean up all processes when service is destroyed
        for (Process process : processes.values()) {
            process.destroy();
        }
        processes.clear();
        processInputs.clear();
        clientMessengers.clear();
        threadPool.shutdown();
    }
}