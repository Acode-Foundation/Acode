package com.foxdebug.acode.rk.exec.terminal;

import android.content.Context;
import android.content.pm.PackageManager;
import java.io.*;
import java.util.Map;
import java.util.TimeZone;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import com.foxdebug.acode.rk.exec.terminal.*;

public class ProcessManager {
    
    private final Context context;
    
    public ProcessManager(Context context) {
        this.context = context;
    }
    
    /**
     * Creates a ProcessBuilder with common environment setup
     */
    public ProcessBuilder createProcessBuilder(String cmd, boolean useAlpine) {
        if (useAlpine) {
            refreshAxsSymlink();
        }
        String xcmd = useAlpine ? "source $PREFIX/init-sandbox.sh " + cmd : cmd;
        ProcessBuilder builder = new ProcessBuilder("sh", "-c", xcmd);
        setupEnvironment(builder.environment());
        return builder;
    }

    /**
     * Play Store builds package axs as a native library. Keep the legacy
     * $PREFIX/axs path valid for scripts and plugins that execute it directly.
     */
    private void refreshAxsSymlink() {
        if (isFdroidBuild()) {
            return;
        }

        Path axsPath = Paths.get(context.getFilesDir().getAbsolutePath(), "axs");
        Path nativeAxsPath = Paths.get(context.getApplicationInfo().nativeLibraryDir, "libaxs.so");

        if (!Files.exists(nativeAxsPath)) {
            return;
        }

        try {
            if (Files.isSymbolicLink(axsPath)) {
                Path currentTarget = Files.readSymbolicLink(axsPath);
                if (currentTarget.equals(nativeAxsPath)) {
                    return;
                }
            }

            Files.deleteIfExists(axsPath);
            Files.createSymbolicLink(axsPath, nativeAxsPath);
        } catch (Exception ignored) {
            // init-sandbox.sh will surface the execution error if the link is unusable.
        }
    }

    private boolean isFdroidBuild() {
        try {
            int target = context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0)
                .applicationInfo.targetSdkVersion;
            return target <= 28;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
    
    /**
     * Sets up common environment variables
     */
    private void setupEnvironment(Map<String, String> env) {
        env.put("PREFIX", context.getFilesDir().getAbsolutePath());
        env.put("NATIVE_DIR", context.getApplicationInfo().nativeLibraryDir);
        
        TimeZone tz = TimeZone.getDefault();
        env.put("ANDROID_TZ", tz.getID());
        
        try {
            int target = context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0)
                .applicationInfo.targetSdkVersion;
            env.put("FDROID", String.valueOf(target <= 28));
        } catch (PackageManager.NameNotFoundException e) {
            e.printStackTrace();
        }
    }
    
    /**
     * Reads all output from a stream
     */
    public static String readStream(InputStream stream) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream));
        StringBuilder output = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            output.append(line).append("\n");
        }
        return output.toString();
    }
    
    /**
     * Executes a command and returns the result
     */
    public ExecResult executeCommand(String cmd, boolean useAlpine) throws Exception {
        ProcessBuilder builder = createProcessBuilder(cmd, useAlpine);
        Process process = builder.start();
        
        String stdout = readStream(process.getInputStream());
        String stderr = readStream(process.getErrorStream());
        int exitCode = process.waitFor();
        
        return new ExecResult(exitCode, stdout.trim(), stderr.trim());
    }
    
    /**
     * Result container for command execution
     */
    public static class ExecResult {
        public final int exitCode;
        public final String stdout;
        public final String stderr;
        
        public ExecResult(int exitCode, String stdout, String stderr) {
            this.exitCode = exitCode;
            this.stdout = stdout;
            this.stderr = stderr;
        }
        
        public boolean isSuccess() {
            return exitCode == 0;
        }
        
        public String getErrorMessage() {
            if (!stderr.isEmpty()) {
                return stderr;
            }
            return "Command exited with code: " + exitCode;
        }
    }
}
