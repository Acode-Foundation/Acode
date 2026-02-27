package com.foxdebug.acode.rk.exec.terminal;

import java.lang.reflect.Field;
import android.util.Log;
import com.foxdebug.acode.rk.exec.terminal.*;

public class ProcessUtils {
    
    /**
     * Gets the PID of a process using reflection
     */
    public static long getPid(Process process) {
        try {
            Field f = process.getClass().getDeclaredField("pid");
            f.setAccessible(true);
            return f.getLong(process);
        } catch (Exception e) {
            return -1;
        }
    }
    
    /**
     * Checks if a process is still alive
     */
    public static boolean isAlive(Process process) {
        try {
            process.exitValue();
            return false;
        } catch(IllegalThreadStateException e) {
            return true;
        }
    }
    
    /**
     * Forcefully kills a process and its children
     */
    public static void killProcessTree(Process process) {
        try {
            long pid = getPid(process);
            if (pid > 0) {
                Runtime.getRuntime().exec("kill -9 -" + pid);
            }
        } catch (Exception error) {
            Log.w("ProcessUtils", "Failed to kill process tree.", error);
        }
        process.destroy();
    }
}
