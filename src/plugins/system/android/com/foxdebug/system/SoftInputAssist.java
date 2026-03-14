package com.foxdebug.system;

import android.app.Activity;
import android.graphics.Rect;
import android.view.View;

public class SoftInputAssist {
    private final View rootView;
    private final View contentView;
    private int baseline = -1;

    public SoftInputAssist(Activity activity) {
        rootView = activity.getWindow().getDecorView();
        contentView = activity.findViewById(android.R.id.content);

        rootView.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            Rect r = new Rect();
            rootView.getWindowVisibleDisplayFrame(r);

            int heightDiff = rootView.getHeight() - (r.bottom - r.top);

            // Save baseline (system bars only)
            if (baseline == -1) {
                baseline = heightDiff;
            }

            int keyboardHeight = heightDiff - baseline;

            if (keyboardHeight > 0) {
                contentView.setPadding(0, 0, 0, keyboardHeight);
            } else {
                contentView.setPadding(0, 0, 0, 0);
            }
        });
    }
}