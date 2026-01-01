package com.foxdebug.acode.rk.customtabs;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;

import androidx.browser.customtabs.CustomTabsIntent;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

public class CustomTabsPlugin extends CordovaPlugin {

    @Override
    public boolean execute(
            String action,
            JSONArray args,
            CallbackContext callbackContext
    ) {

        if ("open".equals(action)) {
            try {
                final String url = args.getString(0);
                final JSONObject options = args.optJSONObject(1) != null
                        ? args.optJSONObject(1)
                        : new JSONObject();

                cordova.getActivity().runOnUiThread(() -> {
                    try {
                        openCustomTab(url, options);
                        callbackContext.success();
                    } catch (Exception e) {
                        callbackContext.error(e.getMessage());
                    }
                });

                return true;

            } catch (Exception e) {
                callbackContext.error(e.getMessage());
                return true;
            }
        }

        return false;
    }

    private void openCustomTab(String url, JSONObject options) {
        CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();

        String toolbarColor = options.optString("toolbarColor", null);
        if (toolbarColor != null && !toolbarColor.isEmpty()) {
            builder.setToolbarColor(Color.parseColor(toolbarColor));
        }

        CustomTabsIntent customTabsIntent = builder.build();

        if (options.optBoolean("showTitle", true)) {
            customTabsIntent.intent.putExtra(CustomTabsIntent.EXTRA_TITLE_VISIBILITY_STATE, CustomTabsIntent.SHOW_PAGE_TITLE);
        }
        
        try {
            customTabsIntent.launchUrl(
                    cordova.getActivity(),
                    Uri.parse(url)
            );
        } catch (ActivityNotFoundException e) {
            // Fallback to default browser
            Intent fallback = new Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse(url)
            );
            cordova.getActivity().startActivity(fallback);
        }
    }
}
