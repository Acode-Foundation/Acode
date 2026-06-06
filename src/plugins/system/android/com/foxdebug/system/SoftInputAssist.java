package com.foxdebug.system;

import android.app.Activity;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public class SoftInputAssist {

    public SoftInputAssist(Activity activity) {
        View contentView = activity.findViewById(android.R.id.content);

        ViewCompat.setOnApplyWindowInsetsListener(contentView, (v, insets) -> {
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            Insets nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars());

            int keyboardHeight = Math.max(0, ime.bottom - nav.bottom);

            v.setPadding(0, 0, 0, keyboardHeight);

            return insets;
        });

        ViewCompat.requestApplyInsets(contentView);
    }
}