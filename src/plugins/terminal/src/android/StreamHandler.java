package com.foxdebug.acode.rk.exec.terminal;

import java.io.*;
import com.foxdebug.acode.rk.exec.terminal.*;
public class StreamHandler {
    
    public interface OutputListener {
        void onLine(String line);
    }
    
    /**
     * Streams output from an InputStream to a listener
     */
    public static void streamOutput(InputStream inputStream, OutputListener listener) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                listener.onLine(line);
            }
        } catch (IOException ignored) {
        }
    }
    
    /**
     * Writes input to an OutputStream
     */
    public static void writeToStream(OutputStream outputStream, String input) throws IOException {
        outputStream.write((input + "\n").getBytes());
        outputStream.flush();
    }
}