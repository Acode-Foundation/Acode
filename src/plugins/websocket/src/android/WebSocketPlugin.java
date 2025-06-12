package com.foxdebug.websocket;

import android.util.Log;

import org.apache.cordova.*;
import org.json.*;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import okhttp3.OkHttpClient;

// TODO: plugin init & plugin destroy(closing okhttp clients) lifecycles. (✅)
public class WebSocketPlugin extends CordovaPlugin {
    private static final ConcurrentHashMap<String, WebSocketInstance> instances = new ConcurrentHashMap<>();
    public OkHttpClient okHttpMainClient = null;

    @Override
    protected void pluginInitialize() {
        this.okHttpMainClient = new OkHttpClient();
    }

    @Override
    public boolean execute(String action, JSONArray args, final CallbackContext callbackContext) throws JSONException {
        cordova.getThreadPool().execute(new Runnable() {
            @Override
            public void run() {

                switch (action) {
                    case "connect":
                        String url = args.optString(0);
                        JSONArray protocols = args.optJSONArray(1);
                        JSONObject headers = args.optJSONObject(2);
                        String binaryType = args.optString(3, null);
                        String id = UUID.randomUUID().toString();
                        WebSocketInstance instance = new WebSocketInstance(url, protocols, headers, binaryType, okHttpMainClient, cordova, id);
                        instances.put(id, instance);
                        callbackContext.success(id);
                        return;

                    case "send":
                        String instanceId = args.optString(0);
                        String message = args.optString(1);
                        boolean isBinary = args.optBoolean(2, false);

                        WebSocketInstance inst = instances.get(instanceId);
                        Log.d("WebSocketPlugin", "send called");
                        if (inst != null) {
                            inst.send(message, isBinary);
                            callbackContext.success();
                        } else {
                            callbackContext.error("Invalid instance ID");
                        }
                        return;

                    case "close":
                        instanceId = args.optString(0);
                        // defaults code to 1000 & reason to "Normal closure"
                        int code = args.optInt(1, 1000);
                        String reason = args.optString(2, "Normal closure");
                        inst = instances.get(instanceId);
                        if (inst != null) {
                            String error = inst.close(code, reason);

                            if(error == null) {
                                callbackContext.success();
                                return;
                            } else if(!error.isEmpty()) {
                                // if error is empty means the websocket is not ready/open.
                                callbackContext.error(error);
                                return;
                            }
                        } else {
                            callbackContext.error("Invalid instance ID");
                        }
                        return;

                    case "registerListener":
                        instanceId = args.optString(0);
                        inst = instances.get(instanceId);
                        if (inst != null) {
                            inst.setCallback(callbackContext);
                        } else {
                            callbackContext.error("Invalid instance ID");
                        }
                        return;

                    case "setBinaryType":
                        instanceId = args.optString(0);
                        String type = args.optString(1);

                        inst = instances.get(instanceId);
                        if (inst != null) {
                            inst.setBinaryType(type);
                        } else {
                            Log.d("WebSocketPlugin", "setBinaryType called for instanceId=" + instanceId + " but It's not found. ignoring....");
                        }
                        return;

                    case "listClients":
                        JSONArray clientIds = new JSONArray();
                        for (String clientId : instances.keySet()) {
                            clientIds.put(clientId);
                        }
                        callbackContext.success(clientIds);
                        return;
                    default:
                        return;
                }
            }
        });
        return true;
    }

    @Override
    public void onDestroy() {
        // clear all.
        for (WebSocketInstance instance : instances.values()) {
            // Closing them gracefully.
            instance.close();
        }
        instances.clear();
        okHttpMainClient.dispatcher().executorService().shutdown();
        Log.i("WebSocketPlugin", "cleaned up... on destroy");
    }

    public static void removeInstance(String instanceId) {
        instances.remove(instanceId);
    }
}
