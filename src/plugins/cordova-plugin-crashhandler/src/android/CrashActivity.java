package com.foxdebug.crashhandler;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
import android.view.Window;
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

    private int colorPrimaryBg;
    private int colorSecondaryBg;
    private int colorPrimaryText;
    private int colorSecondaryText;
    private int colorLinkText;
    private int colorBorder;
    private int colorTraceBg;
    private int colorMetaLabel;
    private int colorMetaValue;
    private int colorButtonPrimaryBg;
    private int colorButtonPrimaryText;
    private int colorButtonSecondaryBg;
    private int colorButtonSecondaryText;
    private boolean isDarkTheme;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        loadThemeColors();
        applySystemBarColors();

        Intent intent = getIntent();
        errorType = intent.getStringExtra("error_type");
        if (errorType == null) errorType = "Unexpected Crash";
        errorMessage = intent.getStringExtra("error_message");
        if (errorMessage == null) errorMessage = "No error message provided";
        stackTrace = intent.getStringExtra("stack_trace");
        if (stackTrace == null) stackTrace = "No stack trace details available.";

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

        ScrollView mainScrollView = new ScrollView(this);
        mainScrollView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        mainScrollView.setBackgroundColor(colorPrimaryBg);
        mainScrollView.setFillViewport(true);

        LinearLayout rootLayout = new LinearLayout(this);
        rootLayout.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams rootParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        int padding = dp(20);
        rootLayout.setPadding(padding, padding, padding, padding);
        rootLayout.setLayoutParams(rootParams);

        TextView titleView = new TextView(this);
        titleView.setText("Acode Crashed");
        titleView.setTextSize(24);
        titleView.setTextColor(colorPrimaryText);
        titleView.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        titleParams.setMargins(0, dp(10), 0, dp(8));
        titleView.setLayoutParams(titleParams);
        rootLayout.addView(titleView);

        TextView descView = new TextView(this);
        descView.setText("An unrecoverable exception occurred in Acode's native system. The application details and exception logs have been recorded below.");
        descView.setTextSize(14);
        descView.setTextColor(colorSecondaryText);
        LinearLayout.LayoutParams descParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        descParams.setMargins(0, 0, 0, dp(20));
        descView.setLayoutParams(descParams);
        rootLayout.addView(descView);

        TextView metaTitleView = new TextView(this);
        metaTitleView.setText("DEVICE & APP INFO");
        metaTitleView.setTextSize(11);
        metaTitleView.setTextColor(colorLinkText);
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
        cardBg.setColor(colorSecondaryBg);
        cardBg.setCornerRadius(dp(4));
        cardBg.setStroke(dp(1), colorBorder);
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

        TextView logsTitleView = new TextView(this);
        logsTitleView.setText("STACK TRACE");
        logsTitleView.setTextSize(11);
        logsTitleView.setTextColor(colorLinkText);
        logsTitleView.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        LinearLayout.LayoutParams logsTitleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        logsTitleParams.setMargins(0, 0, 0, dp(6));
        logsTitleView.setLayoutParams(logsTitleParams);
        rootLayout.addView(logsTitleView);

        LinearLayout traceCard = new LinearLayout(this);
        traceCard.setOrientation(LinearLayout.VERTICAL);
        traceCard.setPadding(dp(12), dp(12), dp(12), dp(12));
        GradientDrawable traceBg = new GradientDrawable();
        traceBg.setColor(colorTraceBg);
        traceBg.setCornerRadius(dp(4));
        traceBg.setStroke(dp(1), colorBorder);
        traceCard.setBackground(traceBg);

        LinearLayout.LayoutParams traceCardParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(280));
        traceCardParams.setMargins(0, 0, 0, dp(24));
        traceCard.setLayoutParams(traceCardParams);

        ScrollView traceVerticalScroll = new ScrollView(this);
        HorizontalScrollView traceHorizontalScroll = new HorizontalScrollView(this);

        TextView traceView = new TextView(this);
        traceView.setText(stackTrace);
        traceView.setTextSize(12);
        traceView.setTextColor(colorSecondaryText);
        traceView.setTypeface(Typeface.MONOSPACE);
        traceView.setHorizontallyScrolling(true);
        traceView.setTextIsSelectable(true);

        traceHorizontalScroll.addView(traceView);
        traceVerticalScroll.addView(traceHorizontalScroll);
        traceCard.addView(traceVerticalScroll);
        rootLayout.addView(traceCard);

        LinearLayout buttonsLayout = new LinearLayout(this);
        buttonsLayout.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams buttonsParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        buttonsLayout.setLayoutParams(buttonsParams);

        TextView btnRestart = createButton("Restart Acode", colorButtonPrimaryText, colorButtonPrimaryBg, false);
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

        TextView btnCopy = createButton("Copy Error Details", colorButtonSecondaryText, colorButtonSecondaryBg, true);
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

        TextView btnClose = createButton("Close", colorButtonSecondaryText, colorButtonSecondaryBg, true);
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

    private void loadThemeColors() {
        SharedPreferences prefs = null;
        try {
            prefs = getApplicationContext()
                    .getSharedPreferences("acode_theme", Context.MODE_PRIVATE);
        } catch (Exception ignored) {}

        colorPrimaryBg = getThemeColor(prefs, "primaryColor", "#23272a");
        colorSecondaryBg = getThemeColor(prefs, "secondaryColor", "#2d3134");
        colorPrimaryText = getThemeColor(prefs, "primaryTextColor", "#f5f5f5");
        colorSecondaryText = getThemeColor(prefs, "secondaryTextColor", "#e4e4e4");
        colorLinkText = getThemeColor(prefs, "linkTextColor", "#8ab4f8");
        colorButtonPrimaryBg = getThemeColor(prefs, "activeColor", "#4285f4");
        colorButtonPrimaryText = getThemeColor(prefs, "buttonTextColor", "#ffffff");
        colorButtonSecondaryBg = colorSecondaryBg;
        colorButtonSecondaryText = colorSecondaryText;

        String themeType = "dark";
        if (prefs != null) {
            try {
                themeType = prefs.getString("type", "dark");
            } catch (Exception ignored) {}
        }
        isDarkTheme = !"light".equals(themeType);

        colorBorder = deriveBorderColor(colorPrimaryBg, colorSecondaryBg);
        colorTraceBg = deriveTraceBg(colorPrimaryBg);
        colorMetaLabel = deriveMetaLabelColor(colorSecondaryText);
        colorMetaValue = colorPrimaryText;
    }

    private int getThemeColor(SharedPreferences prefs, String key, String fallback) {
        if (prefs == null) return safeParseColor(fallback);
        try {
            String value = prefs.getString(key, null);
            if (value != null && !value.isEmpty()) {
                return safeParseColor(value, fallback);
            }
        } catch (Exception ignored) {}
        return safeParseColor(fallback);
    }

    private int safeParseColor(String colorStr) {
        return safeParseColor(colorStr, "#000000");
    }

    private int safeParseColor(String colorStr, String fallback) {
        try {
            return Color.parseColor(colorStr);
        } catch (Exception e) {
            try {
                return Color.parseColor(fallback);
            } catch (Exception e2) {
                return Color.BLACK;
            }
        }
    }

    private int deriveBorderColor(int primary, int secondary) {
        int r = (Color.red(primary) + Color.red(secondary)) / 2;
        int g = (Color.green(primary) + Color.green(secondary)) / 2;
        int b = (Color.blue(primary) + Color.blue(secondary)) / 2;
        if (isDarkTheme) {
            r = Math.min(255, r + 20);
            g = Math.min(255, g + 20);
            b = Math.min(255, b + 20);
        } else {
            r = Math.max(0, r - 20);
            g = Math.max(0, g - 20);
            b = Math.max(0, b - 20);
        }
        return Color.rgb(r, g, b);
    }

    private int deriveTraceBg(int primaryBg) {
        if (isDarkTheme) {
            return Color.rgb(
                    Math.max(0, Color.red(primaryBg) - 12),
                    Math.max(0, Color.green(primaryBg) - 12),
                    Math.max(0, Color.blue(primaryBg) - 12));
        }
        return Color.rgb(
                Math.min(255, Color.red(primaryBg) + 8),
                Math.min(255, Color.green(primaryBg) + 8),
                Math.min(255, Color.blue(primaryBg) + 8));
    }

    private int deriveMetaLabelColor(int secondaryText) {
        return Color.argb(
                180,
                Color.red(secondaryText),
                Color.green(secondaryText),
                Color.blue(secondaryText));
    }

    private void applySystemBarColors() {
        try {
            Window window = getWindow();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                window.setStatusBarColor(colorPrimaryBg);
                window.setNavigationBarColor(colorPrimaryBg);
            }
            if (!isDarkTheme && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                View decorView = window.getDecorView();
                decorView.setSystemUiVisibility(
                        decorView.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            }
        } catch (Exception ignored) {}
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
        labelView.setTextColor(colorMetaLabel);
        labelView.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                dp(100),
                LinearLayout.LayoutParams.WRAP_CONTENT);
        labelView.setLayoutParams(labelParams);

        TextView valView = new TextView(this);
        valView.setText(value);
        valView.setTextSize(13);
        valView.setTextColor(colorMetaValue);
        LinearLayout.LayoutParams valParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        valView.setLayoutParams(valParams);

        row.addView(labelView);
        row.addView(valView);
        return row;
    }

    private TextView createButton(String text, int textColor, int bgColor, boolean hasBorder) {
        final TextView btn = new TextView(this);
        btn.setText(text);
        btn.setTextSize(15);
        btn.setTextColor(textColor);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(dp(16), dp(14), dp(16), dp(14));
        btn.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));

        final GradientDrawable normalBg = new GradientDrawable();
        normalBg.setColor(bgColor);
        normalBg.setCornerRadius(dp(4));

        if (hasBorder) {
            normalBg.setStroke(dp(1), colorBorder);
        }

        btn.setBackground(normalBg);

        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        btnParams.setMargins(0, 0, 0, dp(12));
        btn.setLayoutParams(btnParams);

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
