package com.foxdebug.acode.rk.exec.terminal;

import java.lang.reflect.Field;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
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

    /**
     * Forcefully kills a single process
     */
    public static void killProcess(int pid) {
        try {
            Runtime.getRuntime().exec("kill -9 " + pid).waitFor();
        } catch (Exception ignored) {}
    }

    /**
     * Reads the cmdline file for a given process folder
     */
    private static String readCmdline(File cmdlineFile) {
        try (FileInputStream fis = new FileInputStream(cmdlineFile)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int len;
            while ((len = fis.read(buffer)) != -1) {
                bos.write(buffer, 0, len);
                if (bos.size() > 8192) break; // Limit to 8KB
            }
            byte[] bytes = bos.toByteArray();
            if (bytes.length == 0) return "";
            
            // Replace null bytes with spaces, ignoring trailing nulls
            int end = bytes.length;
            while (end > 0 && bytes[end - 1] == 0) {
                end--;
            }
            for (int i = 0; i < end; i++) {
                if (bytes[i] == 0) {
                    bytes[i] = ' ';
                }
            }
            return new String(bytes, 0, end, StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            return "";
        }
    }

    /**
     * Lists all processes running under the current app UID
     */
    public static JSONArray getAllProcesses() {
        JSONArray processList = new JSONArray();
        int myUid = android.os.Process.myUid();
        int myPid = android.os.Process.myPid();
        File procDir = new File("/proc");
        File[] files = procDir.listFiles();
        if (files == null) {
            return processList;
        }

        for (File file : files) {
            if (file.isDirectory()) {
                String name = file.getName();
                if (name.matches("\\d+")) {
                    int pid = Integer.parseInt(name);
                    try {
                        File statusFile = new File(file, "status");
                        if (!statusFile.exists()) continue;
                        
                        String procName = "";
                        String procState = "";
                        int ppid = -1;
                        long rss = 0;
                        boolean uidMatches = false;

                        try (BufferedReader reader = new BufferedReader(new FileReader(statusFile))) {
                            String line;
                            while ((line = reader.readLine()) != null) {
                                if (line.startsWith("Name:")) {
                                    procName = line.substring(5).trim();
                                } else if (line.startsWith("State:")) {
                                    procState = line.substring(6).trim();
                                } else if (line.startsWith("PPid:")) {
                                    try {
                                        ppid = Integer.parseInt(line.substring(5).trim());
                                    } catch (NumberFormatException ignored) {}
                                } else if (line.startsWith("Uid:")) {
                                    String[] uids = line.substring(4).trim().split("\\s+");
                                    if (uids.length > 0) {
                                        try {
                                            int uid = Integer.parseInt(uids[0]);
                                            if (uid == myUid) {
                                                uidMatches = true;
                                            }
                                        } catch (NumberFormatException ignored) {}
                                    }
                                } else if (line.startsWith("VmRSS:")) {
                                    String rssStr = line.substring(6).trim();
                                    rssStr = rssStr.replaceAll("[^0-9]", "");
                                    try {
                                        rss = Long.parseLong(rssStr); // in kB
                                    } catch (NumberFormatException ignored) {}
                                }
                            }
                        }

                        // Skip processes that do not belong to our app UID
                        if (!uidMatches) {
                            continue;
                        }

                        String cmdline = readCmdline(new File(file, "cmdline"));
                        if (cmdline.isEmpty()) {
                            cmdline = procName;
                        }

                        JSONObject procObj = new JSONObject();
                        procObj.put("pid", pid);
                        procObj.put("ppid", ppid);
                        procObj.put("name", procName);
                        procObj.put("command", cmdline);
                        procObj.put("state", procState);
                        procObj.put("memory", rss); // in kB
                        procObj.put("isSelf", pid == myPid);
                        procObj.put("startedAt", file.lastModified());
                        
                        processList.put(procObj);
                    } catch (Exception ignored) {
                        // Ignore processes we cannot access
                    }
                }
            }
        }
        return processList;
    }
}
