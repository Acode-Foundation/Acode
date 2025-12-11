package com.foxdebug.acode.rk.exec.terminal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class KeepAliveService extends Service {

    private static final String CHANNEL_ID = "keepalive_channel";
    private static final int NOTIFICATION_ID = 101;

    private PowerManager.WakeLock wakeLock;

    public static final String ACTION_ACQUIRE = "ACQUIRE_WAKELOCK";
    public static final String ACTION_EXIT = "EXIT_SERVICE";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {

        if (intent != null && intent.getAction() != null) {
            switch (intent.getAction()) {

                case ACTION_ACQUIRE:
                    acquireWakeLock();
                    break;

                case ACTION_EXIT:
                    stopSelf();
                    break;
            }
        }

        // Update notification (in case state changed)
        startForeground(NOTIFICATION_ID, buildNotification());
        return START_STICKY;
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "KeepAliveService:WakeLock");
            wakeLock.setReferenceCounted(false);
        }

        if (!wakeLock.isHeld()) {
            wakeLock.acquire();
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification() {

        // Intent: Acquire WakeLock
        Intent acquireIntent = new Intent(this, KeepAliveService.class);
        acquireIntent.setAction(ACTION_ACQUIRE);

        PendingIntent acquirePending = PendingIntent.getService(
                this, 0, acquireIntent, PendingIntent.FLAG_IMMUTABLE);

        // Intent: Exit Service
        Intent exitIntent = new Intent(this, KeepAliveService.class);
        exitIntent.setAction(ACTION_EXIT);

        PendingIntent exitPending = PendingIntent.getService(
                this, 1, exitIntent, PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("KeepAlive Service")
                .setContentText("Running in foreground")
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .addAction(0, "Acquire WakeLock", acquirePending)
                .addAction(0, "Exit", exitPending)
                .setOngoing(true);

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {

            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "KeepAlive",
                    NotificationManager.IMPORTANCE_LOW);

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }
}
