package com.foxdebug.system;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Keeps the editor activity independent of the switchable launcher aliases. */
public class LauncherActivity extends Activity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    Intent intent = new Intent(getIntent());
    intent.setClassName(getPackageName(), getPackageName() + ".MainActivity");
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    startActivity(intent);
    finish();
  }
}
