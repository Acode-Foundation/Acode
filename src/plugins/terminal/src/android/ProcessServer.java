package com.foxdebug.acode.rk.exec.terminal;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;

class ProcessServer extends WebSocketServer {

    private final String[] cmd;
    private final CountDownLatch readyLatch = new CountDownLatch(1);

    private static final class ConnState {
        final Process process;
        final OutputStream stdin;

        ConnState(Process process, OutputStream stdin) {
            this.process = process;
            this.stdin   = stdin;
        }
    }

    ProcessServer(int port, String[] cmd) {
        super(new InetSocketAddress("127.0.0.1", port)); // loopback only
        this.cmd = cmd;
    }

    /** Blocks the calling thread until onStart() fires. */
    void startAndAwait() throws InterruptedException {
        start();
        readyLatch.await(); // returns as soon as the server socket is open
    }

    @Override
    public void onStart() {
        readyLatch.countDown(); // unblocks startAndAwait()
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

    @Override
    public void onMessage(WebSocket conn, String message) {
        try {
            ConnState state = conn.getAttachment();
            state.stdin.write(message.getBytes());
            state.stdin.flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        stopProcess(conn);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        if (conn != null) stopProcess(conn);
    }

    private void stopProcess(WebSocket conn) {
        try {
            ConnState state = conn.getAttachment();
            if (state != null) state.process.destroy();
            stop();
        } catch (Exception ignored) {}
    }
}