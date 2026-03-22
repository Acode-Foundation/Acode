package com.foxdebug.acode.rk.exec.terminal;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;

class ProcessServer extends WebSocketServer {

    private String[] cmd;
    private Process process;

    ProcessServer(int port, String[] cmd){
        super(new InetSocketAddress(port));
        this.cmd = cmd;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake){

        try{

            process = new ProcessBuilder(cmd).start();

            InputStream stdout = process.getInputStream();
            OutputStream stdin = process.getOutputStream();

            conn.setAttachment(stdin);

            new Thread(() -> {

                try{

                    byte[] buf = new byte[8192];
                    int len;

                    while((len = stdout.read(buf)) != -1){
                        conn.send(ByteBuffer.wrap(buf,0,len));
                    }

                }catch(Exception ignored){}

            }).start();

        }catch(Exception ignored){}
    }

    @Override
    public void onMessage(WebSocket conn, ByteBuffer msg) {
        try {
            OutputStream stdin = conn.getAttachment();
            stdin.write(msg.array(), msg.position(), msg.remaining());
            stdin.flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        try {
            OutputStream stdin = conn.getAttachment();
            stdin.write(message.getBytes());
            stdin.flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote){
        stopProcess();
    }

    @Override
    public void onError(WebSocket conn, Exception ex){
        stopProcess();
    }

    @Override
    public void onStart(){
    }

    private void stopProcess(){
        try{
            if(process != null) process.destroy();
            stop();
        }catch(Exception ignored){}
    }
}