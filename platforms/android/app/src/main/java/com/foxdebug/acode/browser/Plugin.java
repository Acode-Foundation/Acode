package com.foxdebug.acode.browser;

import android.content.Intent;

import com.foxdebug.acode.runtime.BridgeContext;
import com.foxdebug.acode.runtime.Callback;
import com.foxdebug.acode.runtime.Service;

import org.jetbrains.annotations.NotNull;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class Plugin extends Service {
  BridgeContext bridgeContext;

  @Override
  public void initialize(@NotNull BridgeContext bridgeContext) {
    this.bridgeContext = bridgeContext;
  }

  @Override
  public boolean execute(
    String action,
    JSONArray args,
    Callback callbackContext
  ) throws JSONException {
    if (action.equals("open")) {
      String url = args.getString(0);
      JSONObject theme = args.getJSONObject(1);
      boolean onlyConsole = args.optBoolean(2, false);
      String themeString = theme.toString();
      Intent intent = new Intent(bridgeContext.getWebActivity(), BrowserActivity.class);

      intent.putExtra("url", url);
      intent.putExtra("theme", themeString);
      intent.putExtra("onlyConsole", onlyConsole);
      bridgeContext.getWebActivity().startActivity(intent);
      callbackContext.success("Opened browser");
      return true;
    }
    return false;
  }
}
