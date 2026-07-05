package com.foxdebug.crashhandler;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class CrashActivity extends Activity {

    private String errorType;
    private String errorMessage;
    private String stackTrace;
    private String fullReport;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Retrieve data from intent
        Intent intent = getIntent();
        errorType = intent.getStringExtra("error_type");
        if (errorType == null) errorType = "Unexpected Crash";
        errorMessage = intent.getStringExtra("error_message");
        if (errorMessage == null) errorMessage = "No error message provided";
        stackTrace = intent.getStringExtra("stack_trace");
        if (stackTrace == null) stackTrace = "No stack trace details available.";

        // Build system information
        String appVersion = "Unknown";
        String appBuild = "Unknown";
        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            appVersion = pInfo.versionName;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                appBuild = String.valueOf(pInfo.getLongVersionCode());
            } else {
                appBuild = String.valueOf(pInfo.versionCode);
            }
        } catch (Exception e) {
            // Ignore
        }

        String deviceName = Build.MANUFACTURER + " " + Build.MODEL;
        String androidVersion = Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")";
        String timestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date());

        // Construct full report for copying
        fullReport = "Acode Crash Report\n" +
                "==================\n" +
                "Time: " + timestamp + "\n" +
                "Error Type: " + errorType + "\n" +
                "Error Message: " + errorMessage + "\n" +
                "App Version: " + appVersion + " (" + appBuild + ")\n" +
                "Device: " + deviceName + "\n" +
                "Android Version: " + androidVersion + "\n\n" +
                "Stack Trace:\n" +
                stackTrace;

        // --- Build UI Programmatically (Acode Theme Integration) ---
        // Main Container ScrollView
        ScrollView mainScrollView = new ScrollView(this);
        mainScrollView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        mainScrollView.setBackgroundColor(Color.parseColor("#23272a")); // Acode Primary Dark BG
        mainScrollView.setFillViewport(true);

        // Vertical Content Container
        LinearLayout rootLayout = new LinearLayout(this);
        rootLayout.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams rootParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        int padding = dp(20);
        rootLayout.setPadding(padding, padding, padding, padding);
        rootLayout.setLayoutParams(rootParams);

        // Header Warning Title
        TextView titleView = new TextView(this);
        titleView.setText("Acode Crashed");
        titleView.setTextSize(24);
        titleView.setTextColor(Color.parseColor("#f5f5f5")); // Acode Primary Text
        titleView.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        titleParams.setMargins(0, dp(10), 0, dp(8));
        titleView.setLayoutParams(titleParams);
        rootLayout.addView(titleView);

        // Explanation text
        TextView descView = new TextView(this);
        descView.setText("An unrecoverable exception occurred in Acode's native system. The application details and exception logs have been recorded below.");
        descView.setTextSize(14);
        descView.setTextColor(Color.parseColor("#e4e4e4")); // Acode Secondary Text
        LinearLayout.LayoutParams descParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        descParams.setMargins(0, 0, 0, dp(20));
        descView.setLayoutParams(descParams);
        rootLayout.addView(descView);

        // --- System Metadata Section ---
        TextView metaTitleView = new TextView(this);
        metaTitleView.setText("DEVICE & APP INFO");
        metaTitleView.setTextSize(11);
        metaTitleView.setTextColor(Color.parseColor("#8ab4f8")); // Acode Link Text color (light blue)
        metaTitleView.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        LinearLayout.LayoutParams metaTitleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        metaTitleParams.setMargins(0, 0, 0, dp(6));
        metaTitleView.setLayoutParams(metaTitleParams);
        rootLayout.addView(metaTitleView);

        LinearLayout metaCard = new LinearLayout(this);
        metaCard.setOrientation(LinearLayout.VERTICAL);
        metaCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(Color.parseColor("#2d3134")); // Acode Secondary Panel BG
        cardBg.setCornerRadius(dp(4)); // Acode standard border radius
        cardBg.setStroke(dp(1), Color.parseColor("#3a3e46")); // Acode border color
        metaCard.setBackground(cardBg);

        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        cardParams.setMargins(0, 0, 0, dp(20));
        metaCard.setLayoutParams(cardParams);

        metaCard.addView(createMetaRow("App Version", appVersion + " (" + appBuild + ")"));
        metaCard.addView(createMetaRow("Device", deviceName));
        metaCard.addView(createMetaRow("Android OS", androidVersion));
        metaCard.addView(createMetaRow("Time", timestamp));
        metaCard.addView(createMetaRow("Error Type", errorType));
        rootLayout.addView(metaCard);

        // --- Stack Trace Section ---
        TextView logsTitleView = new TextView(this);
        logsTitleView.setText("STACK TRACE");
        logsTitleView.setTextSize(11);
        logsTitleView.setTextColor(Color.parseColor("#8ab4f8"));
        logsTitleView.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        LinearLayout.LayoutParams logsTitleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        logsTitleParams.setMargins(0, 0, 0, dp(6));
        logsTitleView.setLayoutParams(logsTitleParams);
        rootLayout.addView(logsTitleView);

        // Trace card
        LinearLayout traceCard = new LinearLayout(this);
        traceCard.setOrientation(LinearLayout.VERTICAL);
        traceCard.setPadding(dp(12), dp(12), dp(12), dp(12));
        GradientDrawable traceBg = new GradientDrawable();
        traceBg.setColor(Color.parseColor("#181a1f")); // Monospace editor background
        traceBg.setCornerRadius(dp(4));
        traceBg.setStroke(dp(1), Color.parseColor("#3a3e46"));
        traceCard.setBackground(traceBg);

        LinearLayout.LayoutParams traceCardParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(280)); // Fixed height box for logs
        traceCardParams.setMargins(0, 0, 0, dp(24));
        traceCard.setLayoutParams(traceCardParams);

        ScrollView traceVerticalScroll = new ScrollView(this);
        HorizontalScrollView traceHorizontalScroll = new HorizontalScrollView(this);

        TextView traceView = new TextView(this);
        traceView.setText(stackTrace);
        traceView.setTextSize(12);
        traceView.setTextColor(Color.parseColor("#e4e4e4")); // Clean light-grey code text
        traceView.setTypeface(Typeface.MONOSPACE);
        traceView.setHorizontallyScrolling(true);
        traceView.setTextIsSelectable(true);

        traceHorizontalScroll.addView(traceView);
        traceVerticalScroll.addView(traceHorizontalScroll);
        traceCard.addView(traceVerticalScroll);
        rootLayout.addView(traceCard);

        // --- Buttons Section (Clean Acode style) ---
        LinearLayout buttonsLayout = new LinearLayout(this);
        buttonsLayout.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams buttonsParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        buttonsLayout.setLayoutParams(buttonsParams);

        // Restart Button (Primary Action - Acode Blue theme color)
        TextView btnRestart = createButton("Restart Acode", "#ffffff", "#4285f4", false);
        btnRestart.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent restartIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (restartIntent != null) {
                    restartIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    startActivity(restartIntent);
                }
                finish();
                System.exit(0);
            }
        });
        buttonsLayout.addView(btnRestart);

        // Copy Button (Secondary Action - Flat dark panel with border)
        TextView btnCopy = createButton("Copy Error Details", "#e4e4e4", "#2d3134", true);
        btnCopy.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("Acode Crash Log", fullReport);
                clipboard.setPrimaryClip(clip);
                Toast.makeText(CrashActivity.this, "Copied report to clipboard!", Toast.LENGTH_SHORT).show();
            }
        });
        buttonsLayout.addView(btnCopy);

        // Close Button (Tertiary Action - Flat dark panel with border)
        TextView btnClose = createButton("Close", "#e4e4e4", "#2d3134", true);
        btnClose.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
                System.exit(0);
            }
        });
        buttonsLayout.addView(btnClose);

        rootLayout.addView(buttonsLayout);
        mainScrollView.addView(rootLayout);
        setContentView(mainScrollView);
    }

    private View createMetaRow(String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        rowParams.setMargins(0, 0, 0, dp(6));
        row.setLayoutParams(rowParams);

        TextView labelView = new TextView(this);
        labelView.setText(label + ": ");
        labelView.setTextSize(13);
        labelView.setTextColor(Color.parseColor("#a6accd"));
        labelView.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                dp(100),
                LinearLayout.LayoutParams.WRAP_CONTENT);
        labelView.setLayoutParams(labelParams);

        TextView valView = new TextView(this);
        valView.setText(value);
        valView.setTextSize(13);
        valView.setTextColor(Color.parseColor("#eeffff"));
        LinearLayout.LayoutParams valParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        valView.setLayoutParams(valParams);

        row.addView(labelView);
        row.addView(valView);
        return row;
    }

    private TextView createButton(String text, String textColorHex, String bgHex, boolean hasBorder) {
        final TextView btn = new TextView(this);
        btn.setText(text);
        btn.setTextSize(15);
        btn.setTextColor(Color.parseColor(textColorHex));
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(dp(16), dp(14), dp(16), dp(14));
        btn.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));

        final GradientDrawable normalBg = new GradientDrawable();
        normalBg.setColor(Color.parseColor(bgHex));
        normalBg.setCornerRadius(dp(4)); // Standard Acode popup radius
        
        if (hasBorder) {
            normalBg.setStroke(dp(1), Color.parseColor("#3a3e46")); // Acode border style
        }
        
        btn.setBackground(normalBg);

        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        btnParams.setMargins(0, 0, 0, dp(12));
        btn.setLayoutParams(btnParams);

        // Tactile touch animations
        btn.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (event.getAction() == MotionEvent.ACTION_DOWN) {
                    btn.setAlpha(0.7f);
                } else if (event.getAction() == MotionEvent.ACTION_UP || event.getAction() == MotionEvent.ACTION_CANCEL) {
                    btn.setAlpha(1.0f);
                }
                return false;
            }
        });

        return btn;
    }

    private int dp(float value) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
        );
    }
}
