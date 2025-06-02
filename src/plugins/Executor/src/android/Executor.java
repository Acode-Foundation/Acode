package com.foxdebug.acode.exec;

import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CallbackContext;

import org.json.JSONArray;
import org.json.JSONException;

import java.io.BufferedReader;
import java.io.InputStreamReader;

public class Executor extends CordovaPlugin {

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        cordova.getThreadPool().execute(new Runnable() {
            @Override
            public void run() {
                if ("exec".equals(action)) {
                    try {
                        String cmd = args.getString(0);
                        exec(cmd, callbackContext);
                    } catch (JSONException e) {
                        callbackContext.error("Invalid arguments");
                    }
                } else {
                    callbackContext.error("Unknown action");
                }
            }
        });

        return true;
    }

    private void exec(String cmd, CallbackContext callbackContext) {
    try {
        if (cmd != null && !cmd.isEmpty()) {
            Process process = Runtime.getRuntime().exec(cmd);

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
                callbackContext.success(stdOut.toString().trim());
            } else {
                // Return stderr if command fails
                String errorOutput = stdErr.toString().trim();
                if (errorOutput.isEmpty()) {
                    errorOutput = "Command exited with code: " + exitCode;
                }
                callbackContext.error(errorOutput);
            }
        } else {
            callbackContext.error("Expected one non-empty string argument.");
        }
    } catch (Exception e) {
        e.printStackTrace();
        callbackContext.error("Exception: " + e.getMessage());
    }
}

}
