package com.silkimen.http;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class JsonUtils {
  public static HashMap<String, String> getStringMap(JSONObject object) throws JSONException {
    HashMap<String, String> map = new HashMap<String, String>();

    if (object == null) {
      return map;
    }

    Iterator<?> i = object.keys();

    while (i.hasNext()) {
      String key = (String) i.next();
      map.put(key, object.getString(key));
    }
    return map;
  }

  public static HashMap<String, Object> getObjectMap(JSONObject object) throws JSONException {
    HashMap<String, Object> map = new HashMap<String, Object>();

    if (object == null) {
      return map;
    }

    Iterator<?> i = object.keys();

    while (i.hasNext()) {
      String key = (String) i.next();
      Object value = object.get(key);

      if (value instanceof JSONArray) {
        map.put(key, getObjectList((JSONArray) value));
      } else {
        map.put(key, object.get(key));
      }
    }
    return map;
  }

  public static ArrayList<Object> getObjectList(JSONArray array) throws JSONException {
    ArrayList<Object> list = new ArrayList<Object>();

    for (int i = 0; i < array.length(); i++) {
      list.add(array.get(i));
    }
    return list;
  }
}
