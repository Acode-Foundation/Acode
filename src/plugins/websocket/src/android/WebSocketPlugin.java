package com.foxdebug.websocket;

import android.util.Log;

import org.apache.cordova.*;
import org.json.*;

import java.util.HashMap;
import java.util.UUID;

import okhttp3.OkHttpClient;

// TODO: plugin init & plugin destroy(closing okhttp clients) lifecycles. (✅)
public class WebSocketPlugin extends CordovaPlugin {
    private static final HashMap<String, WebSocketInstance> instances = new HashMap<>();
    public OkHttpClient okHttpMainClient = null;

    @Override
    protected void pluginInitialize() {
        this.okHttpMainClient = new OkHttpClient();
    }

    @Override
    public boolean execute(String action, JSONArray args, final CallbackContext callbackContext) throws JSONException {
        switch (action) {
            case "connect":
                String url = args.optString(0);
                JSONArray protocols = args.optJSONArray(1);
                JSONObject headers = args.optJSONObject(2);
                String id = UUID.randomUUID().toString();
                WebSocketInstance instance = new WebSocketInstance(url, protocols, headers, this.okHttpMainClient, cordova, id);
                instances.put(id, instance);
                callbackContext.success(id);
                return true;

            case "send":
                String instanceId = args.optString(0);
                String message = args.optString(1);
                WebSocketInstance inst = instances.get(instanceId);
                Log.d("WebSocketPlugin", "send called");
                if (inst != null) {
                    inst.send(message);
                    callbackContext.success();
                } else {
                    callbackContext.error("Invalid instance ID");
                }
                return true;

            case "close":
                instanceId = args.optString(0);
                // defaults code to 1000 & reason to "Normal closure"
                int code = args.optInt(1, 1000);
                String reason = args.optString(2, "Normal closure");
                inst = instances.get(instanceId);
                if (inst != null) {
                    String error = inst.close(code, reason);

                    if(error == null) {
                        instances.remove(instanceId);
                        callbackContext.success();
                        return true;
                    } else if(!error.isEmpty()) {
                        // if error is empty means the websocket is not ready/open.
                        callbackContext.error(error);
                    }
                    callbackContext.success();
                } else {
                    callbackContext.error("Invalid instance ID");
                }
                return true;

            case "registerListener":
                instanceId = args.optString(0);
                inst = instances.get(instanceId);
                if (inst != null) {
                    inst.setCallback(callbackContext);
                } else {
                    callbackContext.error("Invalid instance ID");
                }
                return true;

            case "listClients":
                JSONArray clientIds = new JSONArray();
                for (String clientId : instances.keySet()) {
                    clientIds.put(clientId);
                }
                callbackContext.success(clientIds);
                return true;
            default:
                return false;
        }
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
}
