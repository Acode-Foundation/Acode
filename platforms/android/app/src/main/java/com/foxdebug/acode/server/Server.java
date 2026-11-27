package com.foxdebug.acode.server;

import java.io.IOException;
import java.util.HashMap;
import com.foxdebug.acode.runtime.*;
import org.json.JSONArray;
import org.json.JSONException;

public class Server extends Service {

  public HashMap<Integer, NanoHTTPDWebserver> servers;

  @Override
  public void initialize(BridgeContext bridgeContext) {
    super.initialize(bridgeContext);
    servers = new HashMap<Integer, NanoHTTPDWebserver>();
  }

  @Override
  public boolean execute(
    String action,
    JSONArray args,
    Callback callbackContext
  )
    throws JSONException {
    if ("start".equals(action)) {
      try {
        this.start(args, callbackContext);
      } catch (IOException e) {
        e.printStackTrace();
      }
      return true;
    }
    if ("setOnRequestHandler".equals(action)) {
      this.setOnRequestHandler(args, callbackContext);
      return true;
    }
    if ("stop".equals(action)) {
      this.stop(args, callbackContext);
      return true;
    }
    if ("send".equals(action)) {
      this.send(args, callbackContext);
      return true;
    }
    return false; // Returning false results in a "MethodNotFound" error.
  }

  /**
   * Starts the server
   *
   * @param args
   * @param callbackContext
   */
  private void start(JSONArray args, Callback callbackContext)
    throws JSONException, IOException {
    Integer port = 8080;

    if (args.length() == 1) {
      port = args.getInt(0);
    }

    NanoHTTPDWebserver server = servers.get(port);
    if (server != null) {
      callbackContext.success("Server started on port " + port);
      return;
    }

    try {
      server = new NanoHTTPDWebserver(port, host.getContext());
      server.start();
      servers.put(port, server);
      callbackContext.success("Server started on port " + port);
    } catch (Exception e) {
      callbackContext.sendPayload(
        new Payload(Payload.Status.ERROR, e.getMessage())
      );
    }
  }

  private void setOnRequestHandler(
    JSONArray args,
    Callback callbackContext
  )
    throws JSONException {
    Integer port = args.getInt(0);
    NanoHTTPDWebserver server = servers.get(port);
    if (server == null) {
      callbackContext.error("Server not started on port " + port);
      return;
    }
    server.onRequestCallbackContext = callbackContext;
  }

  /**
   * Stops the server
   *
   * @param args
   * @param callbackContext
   */
  private void stop(JSONArray args, Callback callbackContext)
    throws JSONException {
    Integer port = args.getInt(0);
    NanoHTTPDWebserver server = servers.get(port);
    if (server == null) {
      callbackContext.error("Server not started on port " + port);
      return;
    }
    server.stop();
    servers.remove(port);
    callbackContext.sendPayload(new Payload(Payload.Status.OK));
  }

  /**
   * Will be called if the js context sends an response to the webserver
   *
   * @param args            {UUID: {...}}
   * @param callbackContext
   * @throws JSONException
   */
  private void send(JSONArray args, Callback callbackContext)
    throws JSONException {
    Integer port = args.getInt(0);
    NanoHTTPDWebserver server = this.servers.get(port);
    if (server == null) {
      callbackContext.sendPayload(
        new Payload(Payload.Status.ERROR, "Server not running")
      );
      return;
    }
    server.responses.put(args.getString(1), args.get(2));
    callbackContext.sendPayload(new Payload(Payload.Status.OK));
  }
}
