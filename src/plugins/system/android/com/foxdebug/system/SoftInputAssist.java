package com.foxdebug.system;

import android.app.Activity;
import android.view.View;
import java.util.List;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsAnimationCompat;

public class SoftInputAssist {

    private boolean animationRunning = false;

    public SoftInputAssist(Activity activity) {
        View contentView = activity.findViewById(android.R.id.content);

        ViewCompat.setOnApplyWindowInsetsListener(contentView, (v, insets) -> {

            if (!animationRunning) {
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                Insets nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars());

                int keyboardHeight = Math.max(0, ime.bottom - nav.bottom);

                v.setPadding(0, 0, 0, keyboardHeight);
            }

            return insets;
        });

        ViewCompat.setWindowInsetsAnimationCallback(
            contentView,
            new WindowInsetsAnimationCompat.Callback(
                WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
            ) {

                @Override
                public void onPrepare(WindowInsetsAnimationCompat animation) {
                    animationRunning = true;
                }

                @Override
                public void onEnd(WindowInsetsAnimationCompat animation) {
                    animationRunning = false;
                }

                @Override
                public WindowInsetsCompat onProgress(
                        WindowInsetsCompat insets,
                        List<WindowInsetsAnimationCompat> runningAnimations) {

                    Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                    Insets nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars());

                    int keyboardHeight = Math.max(0, ime.bottom - nav.bottom);

                    contentView.setPadding(contentView.getPaddingLeft(), contentView.getPaddingTop(), contentView.getPaddingRight(), keyboardHeight);

                    return insets;
                }
            }
        );
    }
}