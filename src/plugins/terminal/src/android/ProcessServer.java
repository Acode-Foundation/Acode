package com.foxdebug.acode.rk.exec.terminal;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

class ProcessServer extends WebSocketServer {

    private final String[] cmd;
    private final CountDownLatch readyLatch = new CountDownLatch(1);

    // Holds a bind-time exception if onError fires before onStart.
    // AtomicReference because onError and startAndAwait run on different threads.
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

    /**
     * Starts the server and blocks until it is listening.
     * Throws if the server fails to bind so the caller can report the error
     * instead of hanging indefinitely.
     */
    void startAndAwait() throws Exception {
        start();
        readyLatch.await();

        // Re-throw any bind-time error captured in onError
        Exception err = startError.get();
        if (err != null) throw err;
    }

    @Override
    public void onStart() {
        readyLatch.countDown(); // server is listening — unblock startAndAwait()
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        if (conn == null) {
            // Startup/bind failure — record it and unblock startAndAwait()
            // so it can throw rather than hang.
            startError.set(ex);
            readyLatch.countDown();
        } else {
            stopProcess(conn);
        }
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
            }).start();

        } catch (Exception ignored) {}
    }

    @Override
    public void onMessage(WebSocket conn, ByteBuffer msg) {
        try {
            ConnState state = conn.getAttachment();
            state.stdin.write(msg.array(), msg.position(), msg.remaining());
            state.stdin.flush();
        } catch (Exception ignored) {}
    }

            state.stdin.write(message.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            state.stdin.write(message.getBytes());
            state.stdin.flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        stopProcess(conn);
    }

    private void stopProcess(WebSocket conn) {
        try {
            ConnState state = conn.getAttachment();
            if (state != null) state.process.destroy();
            stop();
        } catch (Exception ignored) {}
    }
}