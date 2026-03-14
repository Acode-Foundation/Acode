package com.foxdebug.system;

import android.app.Activity;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsAnimationCompat;

public class SoftInputAssist {

    public SoftInputAssist(Activity activity) {
        View contentView = activity.findViewById(android.R.id.content);

        ViewCompat.setWindowInsetsAnimationCallback(
            contentView,
            new WindowInsetsAnimationCompat.Callback(
                WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
            ) {
                @Override
                public WindowInsetsCompat onProgress(
                        WindowInsetsCompat insets,
                        java.util.List<WindowInsetsAnimationCompat> runningAnimations) {

                    Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                    Insets nav = insets.getInsets(WindowInsetsCompat.Type.systemBars());

                    int keyboardHeight = Math.max(0, ime.bottom - nav.bottom);

                    contentView.setPadding(0, 0, 0, keyboardHeight);

                    return insets;
                }
            }
        );
    }
}