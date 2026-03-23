package com.foxdebug.acode.rk.exec.terminal;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

class ProcessServer extends WebSocketServer {

    private final String[] cmd;
    private final CountDownLatch readyLatch = new CountDownLatch(1);
    private final AtomicReference<Exception> startError = new AtomicReference<>();

    private static final class ConnState {
        final Process process;
        final OutputStream stdin;

        ConnState(Process process, OutputStream stdin) {
            this.process = process;
            this.stdin   = stdin;
        }
    }

    ProcessServer(int port, String[] cmd) {
        super(new InetSocketAddress("127.0.0.1", port));
        this.cmd = cmd;
    }

    void startAndAwait() throws Exception {
        start();
        readyLatch.await();
        Exception err = startError.get();
        if (err != null) throw err;
    }

    @Override
    public void onStart() {
        readyLatch.countDown();
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        if (conn == null) {
            // Bind/startup failure — unblock startAndAwait() so it can throw.
            startError.set(ex);
            readyLatch.countDown();
        }
        // Per-connection errors: do nothing. onClose fires immediately after
        // for the same connection, which is the single place cleanup happens.
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        try {
            Process process = new ProcessBuilder(cmd).redirectErrorStream(true).start();
            InputStream  stdout = process.getInputStream();
            OutputStream stdin  = process.getOutputStream();

            conn.setAttachment(new ConnState(process, stdin));

            new Thread(() -> {
                try {
                    byte[] buf = new byte[8192];
                    int len;
                    while ((len = stdout.read(buf)) != -1) {
                        conn.send(ByteBuffer.wrap(buf, 0, len));
                    }
                } catch (Exception ignored) {}
                conn.close(1000, "process exited");
            }).start();

        } catch (Exception e) {
            conn.close(1011, "Failed to start process: " + e.getMessage());
        }
    }

    @Override
    public void onMessage(WebSocket conn, ByteBuffer msg) {
        try {
            ConnState state = conn.getAttachment();
            state.stdin.write(msg.array(), msg.position(), msg.remaining());
            state.stdin.flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        try {
            ConnState state = conn.getAttachment();
            state.stdin.write(message.getBytes(StandardCharsets.UTF_8));
            state.stdin.flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        try {
            ConnState state = conn.getAttachment();
            if (state != null) state.process.destroy();
        } catch (Exception ignored) {}

        // stop() calls w.join() on every worker thread. If called directly from
        // onClose (which runs on a WebSocketWorker thread), it deadlocks waiting
        // for itself to finish. A separate thread sidesteps that entirely.
        new Thread(() -> {
            try {
                stop();
            } catch (Exception ignored) {}
        }).start();
    }
}