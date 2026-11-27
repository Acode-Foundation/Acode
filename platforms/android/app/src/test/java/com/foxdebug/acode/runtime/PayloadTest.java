package com.foxdebug.acode.runtime;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 29, manifest = Config.NONE)
public class PayloadTest {

  @Test
  public void preservesDefaultStatusMessagesAndExplicitNull() throws Exception {
    assertEquals("OK", new Payload(Payload.Status.OK).toJSON(1, 0).get("data"));
    assertEquals(
      "Invalid action",
      new Payload(Payload.Status.INVALID_ACTION).toJSON(1, 0).get("data")
    );
    assertTrue(
      new Payload(Payload.Status.OK, null).toJSON(1, 0).isNull("data")
    );
  }

  @Test
  public void preservesEmptyErrorsAndCallbackRetention() throws Exception {
    Payload payload = new Payload(Payload.Status.ERROR, "");
    payload.setKeepCallback(true);
    JSONObject result = payload.toJSON(7, 3);
    assertEquals(9, result.getInt("status"));
    assertEquals("", result.getString("data"));
    assertTrue(result.getBoolean("keep"));
    assertEquals(3, result.getLong("generation"));
  }

  @Test
  public void encodesBinaryWithoutLosingZeroOrHighBytes() throws Exception {
    Payload payload = new Payload(Payload.Status.OK, new byte[] {
      0,
      (byte) 255,
    });
    JSONObject data = payload.toJSON(1, 0).getJSONObject("data");
    assertEquals("arrayBuffer", data.getString("kind"));
    assertEquals("AP8=", data.getString("data"));
  }

  @Test
  public void preservesMultipartArgumentOrder() throws Exception {
    Payload payload = new Payload(
      Payload.Status.OK,
      java.util.Arrays.asList(
        new Payload(Payload.Status.OK, "data"),
        new Payload(Payload.Status.OK, 42)
      )
    );
    JSONObject result = payload.toJSON(1, 0).getJSONObject("data");
    assertEquals("multipart", result.getString("kind"));
    assertEquals("data", result.getJSONArray("data").getString(0));
    assertEquals(42, result.getJSONArray("data").getInt(1));
  }
}
