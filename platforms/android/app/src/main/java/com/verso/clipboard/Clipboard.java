package com.verso.clipboard;

import com.foxdebug.acode.runtime.Service;
import com.foxdebug.acode.runtime.Payload;
import com.foxdebug.acode.runtime.Callback;

import org.json.JSONArray;
import org.json.JSONException;

import android.content.Context;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.ClipDescription;

public class Clipboard extends Service {

    private static final String actionCopy = "copy";
    private static final String actionPaste = "paste";
    private static final String actionClear = "clear";

    @Override
    public boolean execute(String action, JSONArray args, Callback callbackContext) throws JSONException {
        ClipboardManager clipboard = (ClipboardManager) host.getActivity().getSystemService(Context.CLIPBOARD_SERVICE);

        if (action.equals(actionCopy)) {
            try {
                String text = args.getString(0);
                ClipData clip = ClipData.newPlainText("Text", text);

                clipboard.setPrimaryClip(clip);

                callbackContext.success(text);

                return true;
            } catch (JSONException e) {
                callbackContext.sendPayload(new Payload(Payload.Status.JSON_EXCEPTION));
            } catch (Exception e) {
                callbackContext.sendPayload(new Payload(Payload.Status.ERROR, e.toString()));
            }
        } else if (action.equals(actionPaste)) {
            try {
                String text = "";
                
                ClipData clip = clipboard.getPrimaryClip();
                if (clip != null) {
                    ClipData.Item item = clip.getItemAt(0);
                    text = item.getText().toString();
                }
                callbackContext.success(text);

                return true;
            } catch (Exception e) {
                callbackContext.sendPayload(new Payload(Payload.Status.ERROR, e.toString()));
            }
        } else if (action.equals(actionClear)) {
            try {
                ClipData clip = ClipData.newPlainText("", "");
                clipboard.setPrimaryClip(clip);

                callbackContext.sendPayload(new Payload(Payload.Status.OK));

                return true;
            } catch (Exception e) {
                callbackContext.sendPayload(new Payload(Payload.Status.ERROR, e.toString()));
            }
        }

        return false;
    }
}


