package com.foxdebug.browser;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.drawable.GradientDrawable;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupWindow;
import android.widget.ScrollView;
import android.widget.TextView;
import com.foxdebug.acode.R;
import com.foxdebug.system.Ui;

public class Menu extends PopupWindow {

  private Ui.Theme theme;
  private LinearLayout list;
  private Callback callback;

  Context context;
  int itemHeight;
  int imageSize;
  int padding;

  public abstract static class Callback {

    public abstract void onSelect(String action, Boolean checked);
  }

  public Menu(Context context, Ui.Theme theme) {
    super(context);
    this.theme = theme;
    this.context = context;

    padding = Ui.dpToPixels(context, 5);
    imageSize = Ui.dpToPixels(context, 30);
    itemHeight = Ui.dpToPixels(context, 40);

    MenuItem exit;
    GradientDrawable border;
    MenuItem toggleDisableCache;

    border = new GradientDrawable();
    border.setColor(theme.get("popupBackgroundColor"));
    border.setCornerRadius(Ui.dpToPixels(context, 8));

    list = new LinearLayout(context);
    list.setOrientation(LinearLayout.VERTICAL);
    list.setBackgroundDrawable(border);
    list.setPadding(padding, padding, padding, padding);
    list.setLayoutParams(
      new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
    );

    ScrollView scrollView = new ScrollView(context);
    scrollView.addView(list);

    setElevation(10f);
    setFocusable(true);
    setContentView(scrollView);
    setBackgroundDrawable(border);
    setAnimationStyle(R.style.MenuAnimation);
  }

  public void setCallback(Callback callback) {
    this.callback = callback;
  }

  public void addItem(String icon, String text) {
    addItem(icon, text, null);
  }

  public void addItem(String icon, String text, Boolean toggle) {
    int textColor = theme.get("popupTextColor");
    int background = theme.get("popupBackgroundColor");
    MenuItem menuItem = new MenuItem(this, text);
    menuItem.setBackgroundColor(background);
    menuItem.setIcon(icon, textColor);
    menuItem.setText(text, textColor);
    menuItem.setOnClickListener(
      new MenuItemCallback() {
        @Override
        public void onClick(MenuItem menuItem) {
          callback.onSelect(menuItem.action, menuItem.checked);
          hide();
        }
      }
    );

    if (toggle != null) {
      menuItem.setChecked(toggle);
    }

    list.addView(menuItem);
  }

  public void setChecked(String action, Boolean checked) {
    for (int i = 0; i < list.getChildCount(); i++) {
      MenuItem menuItem = (MenuItem) list.getChildAt(i);
      if (menuItem.action == action) {
        menuItem.setChecked(checked);
        break;
      }
    }
  }

  public void setVisible(String action, Boolean visible) {
    for (int i = 0; i < list.getChildCount(); i++) {
      MenuItem menuItem = (MenuItem) list.getChildAt(i);
      if (menuItem.action == action) {
        menuItem.setVisibility(visible ? View.VISIBLE : View.GONE);
        break;
      }
    }
  }

  public void show(View view) {
    int x = view.getLeft();
    int y = view.getTop();
    showAtLocation(view, Gravity.TOP | Gravity.RIGHT, padding, padding);
  }

  public void hide() {
    dismiss();
  }
}

abstract class MenuItemCallback {

  public abstract void onClick(MenuItem menuItem);
}

class MenuItem extends LinearLayout {

  private Context context;

  public Boolean checked;
  public CheckBox checkBox;
  public String action;
  private int textColor;
  private int itemHeight;
  private int imageSize;
  private int padding;
  private int iconSize;
  private int paddingLeft = 0;
  private int paddingRight = 0;
  private int paddingVertical = 0;

  public MenuItem(Menu menu, String action) {
    super(menu.context);
    this.action = action;

    context = menu.context;
    padding = menu.padding;
    imageSize = menu.imageSize;
    itemHeight = menu.itemHeight;
    iconSize = Ui.dpToPixels(context, 10);
    paddingRight = imageSize;
    paddingVertical = Ui.dpToPixels(context, 5);

    setPadding();
    setClickable(true);
    setLayoutParams(
      new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        itemHeight
      )
    );
    setGravity(Gravity.CENTER_VERTICAL);
    setOrientation(LinearLayout.HORIZONTAL);
    addView(new TextView(context));
  }

  public void setPadding() {
    setPadding(paddingLeft, paddingVertical, paddingRight, paddingVertical);
  }

  public void setIcon(String icon, int iconColor) {
    ImageView imageView = new ImageView(context);
    Bitmap iconBitmap = Ui.Icons.get(context, icon, iconColor);
    imageView.setImageBitmap(iconBitmap);
    imageView.setBackgroundDrawable(null);
    imageView.setLayoutParams(
      new LinearLayout.LayoutParams(imageSize, imageSize)
    );
    imageView.setScaleType(ImageView.ScaleType.FIT_CENTER);
    imageView.setAdjustViewBounds(true);
    imageView.setPadding(padding, padding, padding, padding);
    addView(imageView, 0);
  }

  public void setText(String text, int color) {
    textColor = color;
    TextView textView = new TextView(context);
    LinearLayout.LayoutParams textViewParams = new LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.FILL_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
      1
    );
    textView.setText(text);
    textView.setTextColor(textColor);
    textView.setGravity(Gravity.CENTER_VERTICAL);
    textView.setLayoutParams(textViewParams);
    addView(textView, 1);
  }

  public void setChecked(boolean checked) {
    this.checked = checked;
    if (checkBox != null) {
      checkBox.setChecked(checked);
      return;
    }

    checkBox = new CheckBox(context);
    checkBox.setChecked(checked);
    checkBox.setEnabled(false);
    checkBox.setClickable(false);
    checkBox.setButtonTintList(
      new ColorStateList(
        new int[][] {
          new int[] { android.R.attr.state_checked },
          new int[] { -android.R.attr.state_checked },
        },
        new int[] { textColor, textColor }
      )
    );

    FrameLayout container = new FrameLayout(context);
    FrameLayout.LayoutParams containerParams = new FrameLayout.LayoutParams(
      imageSize,
      imageSize
    );
    containerParams.gravity = Gravity.CENTER_VERTICAL;
    container.setLayoutParams(containerParams);
    container.addView(checkBox);

    paddingRight = 0;
    setPadding();
    addView(container);
  }

  public void setOnClickListener(MenuItemCallback listener) {
    MenuItem self = this;
    this.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View v) {
            if (checkBox != null) {
              checked = !checked;
              checkBox.setChecked(checked);
            }

            listener.onClick(self);
          }
        }
      );
  }
}
