package com.foxdebug.acode.websocket;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.List;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okio.ByteString;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import com.foxdebug.acode.runtime.Callback;
import com.foxdebug.acode.runtime.BaseWebActivity;
import com.foxdebug.acode.runtime.Payload;
import com.foxdebug.acode.runtime.webview.AppWebView;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 29)
public class WebSocketInstanceTest {
    @Test
    @SuppressWarnings("unchecked")
    public void deliversEarlyOpenMessageAndCloseInOrder() throws Exception {
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Class<BaseWebActivity> activityClass = (Class<BaseWebActivity>) (Class<?>) com.foxdebug.acode.MainActivity.class;
        try (org.robolectric.android.controller.ActivityController<BaseWebActivity> controller = Robolectric.buildActivity(activityClass).setup()) {
            BaseWebActivity activity = controller.get();
            AppWebView view = (AppWebView) activity.getContentView().getChildAt(0);
            Request[] requests = new Request[1];
            WebSocket.Factory factory = (request, listener) -> { requests[0] = request; return null; };
            WebSocketInstance socket = new WebSocketInstance("ws://localhost/test", new JSONArray().put("test"), new JSONObject().put("Authorization", "token"), "arraybuffer", factory, activity.getHost(), "early");
            assertEquals("token", requests[0].header("Authorization"));
            assertEquals("test", requests[0].header("Sec-WebSocket-Protocol"));
            socket.onOpen(null, new Response.Builder().request(requests[0]).protocol(Protocol.HTTP_1_1).code(101).message("Switching Protocols").build());
            socket.onMessage(null, ByteString.of((byte) 0, (byte) 255));
            socket.onClosed(null, 1000, "done");

            List<JSONObject> events = new ArrayList<>();
            List<Boolean> retained = new ArrayList<>();
            socket.setCallback(new Callback(1, view) {
                @Override public synchronized void sendPayload(Payload payload) {
                    if (payload.getStatus() == Payload.Status.NO_RESULT.ordinal()) return;
                    retained.add(payload.getKeepCallback());
                    try { events.add(payload.toJSON(1, 0).getJSONObject("data")); }
                    catch (Exception error) { throw new AssertionError(error); }
                }
            });
            assertEquals(3, events.size());
            assertEquals(java.util.Arrays.asList(true, true, false), retained);
            assertEquals("open", events.get(0).getString("type"));
            assertEquals("AP8=", events.get(1).getString("data"));
            assertTrue(events.get(1).getBoolean("isBinary"));
            assertEquals("close", events.get(2).getString("type"));
            assertEquals(1000, new JSONObject(events.get(2).getString("data")).getInt("code"));
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(previous);
        }
    }
}
