package com.foxdebug.sftp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.text.InputType;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import android.util.Base64;

/** Collects SSH credentials in native views so WebView code never receives them. */
final class SftpProfileEditor {

  private static final int PICK_PRIVATE_KEY = 7105;

  private final Sftp plugin;
  private final CordovaInterface cordova;
  private final Activity activity;
  private final SftpSecurityStore store;
  private AlertDialog dialog;
  private Button keyButton;
  private Uri selectedKey;

  SftpProfileEditor(
    Sftp plugin,
    CordovaInterface cordova,
    Activity activity,
    SftpSecurityStore store
  ) {
    this.plugin = plugin;
    this.cordova = cordova;
    this.activity = activity;
    this.store = store;
  }

  void show(JSONArray args, CallbackContext callback) {
    activity.runOnUiThread(
      () -> {
        try {
          showDialog(args, callback);
        } catch (Exception e) {
          callback.error("Could not open the SFTP profile editor: " + message(e));
        }
      }
    );
  }

  private void showDialog(JSONArray args, CallbackContext callback)
    throws Exception {
    if (dialog != null && dialog.isShowing()) {
      callback.error("Another SFTP profile is already being edited");
      return;
    }

    String requestedID = nullableProfileID(args);
    JSONObject existing = requestedID == null
      ? null
      : store.getProfile(requestedID);

    String hostname = existing == null
      ? args.optString(1)
      : existing.optString("hostname");
    int port = existing == null
      ? args.optInt(2, 22)
      : existing.optInt("port", 22);
    String username = existing == null
      ? args.optString(3)
      : existing.optString("username");
    String authType = existing == null
      ? args.optString(4, "password")
      : existing.optString("authType", "password");
    String alias = args.optString(5);

    LinearLayout form = new LinearLayout(activity);
    form.setOrientation(LinearLayout.VERTICAL);
    int padding = Math.round(24 * activity.getResources().getDisplayMetrics().density);
    form.setPadding(padding, padding / 2, padding, 0);

    EditText aliasInput = input("Connection name", alias, false);
    EditText hostInput = input("Hostname", hostname, false);
    EditText portInput = input("Port", String.valueOf(port), false);
    portInput.setInputType(InputType.TYPE_CLASS_NUMBER);
    EditText userInput = input("Username", username, false);
    Spinner authInput = new Spinner(activity);
    authInput.setAdapter(
      new ArrayAdapter<String>(
        activity,
        android.R.layout.simple_spinner_dropdown_item,
        new String[] { "Password", "Private key" }
      )
    );
    authInput.setSelection("key".equals(authType) ? 1 : 0);
    EditText passwordInput = input(
      existing != null && "password".equals(authType)
        ? "Password (leave blank to keep saved password)"
        : "Password",
      "",
      true
    );
    keyButton = new Button(activity);
    keyButton.setAllCaps(false);
    keyButton.setText(
      existing != null && "key".equals(authType)
        ? "Use saved private key (tap to replace)"
        : "Select private key"
    );
    keyButton.setOnClickListener(ignored -> selectPrivateKey());
    EditText passphraseInput = input(
      existing != null && "key".equals(authType)
        ? "Passphrase (leave blank to keep saved passphrase)"
        : "Passphrase (optional)",
      "",
      true
    );

    form.addView(aliasInput);
    form.addView(hostInput);
    form.addView(portInput);
    form.addView(userInput);
    form.addView(authInput);
    form.addView(passwordInput);
    form.addView(keyButton);
    form.addView(passphraseInput);

    Runnable updateAuthFields = () -> {
      boolean useKey = authInput.getSelectedItemPosition() == 1;
      passwordInput.setVisibility(useKey ? View.GONE : View.VISIBLE);
      keyButton.setVisibility(useKey ? View.VISIBLE : View.GONE);
      passphraseInput.setVisibility(useKey ? View.VISIBLE : View.GONE);
    };
    authInput.setOnItemSelectedListener(
      new android.widget.AdapterView.OnItemSelectedListener() {
        @Override
        public void onItemSelected(
          android.widget.AdapterView<?> parent,
          View view,
          int position,
          long id
        ) {
          updateAuthFields.run();
        }

        @Override
        public void onNothingSelected(android.widget.AdapterView<?> parent) {}
      }
    );
    updateAuthFields.run();

    ScrollView scroll = new ScrollView(activity);
    scroll.addView(form);
    AtomicBoolean completed = new AtomicBoolean(false);
    final String profileID = requestedID;
    final JSONObject savedProfile = existing;

    dialog = new AlertDialog.Builder(activity)
      .setTitle(profileID == null ? "Add SFTP connection" : "Edit SFTP connection")
      .setView(scroll)
      .setNegativeButton(
        "Cancel",
        (ignored, which) -> {
          if (completed.compareAndSet(false, true)) {
            callback.error("SFTP profile editing was cancelled");
          }
        }
      )
      .setPositiveButton("Save", null)
      .create();
    dialog.setOnShowListener(
      ignored ->
        dialog
          .getButton(AlertDialog.BUTTON_POSITIVE)
          .setOnClickListener(
            view ->
              save(
                profileID,
                savedProfile,
                aliasInput,
                hostInput,
                portInput,
                userInput,
                authInput,
                passwordInput,
                passphraseInput,
                callback,
                completed
              )
          )
    );
    dialog.setOnDismissListener(ignored -> {
      dialog = null;
      keyButton = null;
      selectedKey = null;
    });
    dialog.setOnCancelListener(ignored -> {
      if (completed.compareAndSet(false, true)) {
        callback.error("SFTP profile editing was cancelled");
      }
    });
    dialog.show();
  }

  private EditText input(String hint, String value, boolean secret) {
    EditText input = new EditText(activity);
    input.setHint(hint);
    input.setSingleLine(true);
    input.setText(value == null ? "" : value);
    if (secret) {
      input.setInputType(
        InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
      );
    }
    return input;
  }

  private static String nullableProfileID(JSONArray args) {
    if (args.length() == 0 || args.isNull(0)) return null;
    String value = args.optString(0, null);
    if (value == null) return null;
    value = value.trim();
    if (
      value.isEmpty() ||
      "null".equalsIgnoreCase(value) ||
      "undefined".equalsIgnoreCase(value)
    ) return null;
    return value;
  }

  private void selectPrivateKey() {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("*/*");
    cordova.setActivityResultCallback(plugin);
    cordova.startActivityForResult(plugin, intent, PICK_PRIVATE_KEY);
  }

  boolean onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode != PICK_PRIVATE_KEY) return false;
    if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
      selectedKey = data.getData();
      if (keyButton != null) keyButton.setText("Private key selected");
    }
    return true;
  }

  private void save(
    String profileID,
    JSONObject existing,
    EditText aliasInput,
    EditText hostInput,
    EditText portInput,
    EditText userInput,
    Spinner authInput,
    EditText passwordInput,
    EditText passphraseInput,
    CallbackContext callback,
    AtomicBoolean completed
  ) {
    String alias = aliasInput.getText().toString().trim();
    String hostname = hostInput.getText().toString().trim();
    String username = userInput.getText().toString().trim();
    int port;
    try {
      port = Integer.parseInt(portInput.getText().toString().trim());
    } catch (NumberFormatException e) {
      portInput.setError("Enter a valid port");
      return;
    }
    if (alias.isEmpty()) {
      aliasInput.setError("Connection name is required");
      return;
    }
    if (hostname.isEmpty()) {
      hostInput.setError("Hostname is required");
      return;
    }
    if (username.isEmpty()) {
      userInput.setError("Username is required");
      return;
    }
    if (port < 1 || port > 65535) {
      portInput.setError("Port must be between 1 and 65535");
      return;
    }

    boolean useKey = authInput.getSelectedItemPosition() == 1;
    String password = passwordInput.getText().toString();
    String passphrase = passphraseInput.getText().toString();
    Uri keyUri = selectedKey;
    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);

    cordova
      .getThreadPool()
      .execute(
        () -> {
          try {
            JSONObject profile = new JSONObject();
            profile.put("hostname", hostname);
            profile.put("port", port);
            profile.put("username", username);
            profile.put("authType", useKey ? "key" : "password");
            if (useKey) {
              String privateKey;
              if (keyUri != null) {
                privateKey = Base64.encodeToString(
                  readUri(keyUri),
                  Base64.NO_WRAP
                );
              } else if (
                existing != null && "key".equals(existing.optString("authType"))
              ) {
                privateKey = existing.getString("privateKey");
              } else {
                throw new IllegalArgumentException("Select a private key");
              }
              profile.put("privateKey", privateKey);
              profile.put(
                "passphrase",
                passphrase.isEmpty() &&
                  existing != null &&
                  keyUri == null &&
                  "key".equals(existing.optString("authType"))
                  ? existing.optString("passphrase")
                  : passphrase
              );
            } else {
              profile.put(
                "password",
                password.isEmpty() &&
                  existing != null &&
                  "password".equals(existing.optString("authType"))
                  ? existing.optString("password")
                  : password
              );
            }

            String savedID = store.saveProfile(profileID, profile);
            JSONObject result = new JSONObject();
            result.put("profileId", savedID);
            result.put("alias", alias);
            result.put("hostname", hostname);
            result.put("port", port);
            result.put("username", username);
            result.put("authType", useKey ? "key" : "password");
            completed.set(true);
            callback.success(result);
            activity.runOnUiThread(() -> dialog.dismiss());
          } catch (Exception e) {
            activity.runOnUiThread(
              () -> {
                if (dialog != null) {
                  dialog
                    .getButton(AlertDialog.BUTTON_POSITIVE)
                    .setEnabled(true);
                }
                Toast.makeText(
                  activity,
                  "Could not save SFTP profile: " + message(e),
                  Toast.LENGTH_LONG
                ).show();
              }
            );
          }
        }
      );
  }

  private byte[] readUri(Uri uri) throws IOException {
    try (
      InputStream input = activity.getContentResolver().openInputStream(uri);
      ByteArrayOutputStream output = new ByteArrayOutputStream()
    ) {
      if (input == null) throw new IOException("Could not open private key");
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
      return output.toByteArray();
    }
  }

  private static String message(Throwable error) {
    return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
  }
}
