# Android spline attribution

The one-dimensional fling calculations in `src/android-spline.ts` are derived
from Android Open Source Project `android.widget.OverScroller`, as distributed
with Android SDK Platform 36. Acode ported the calculations to TypeScript and
modified them for CSS-pixel, one-dimensional, render-gated scrolling.

Copyright (C) 2010 The Android Open Source Project

Licensed under the Apache License, Version 2.0. The complete license is included
in [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0).

Upstream source:
<https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/core/java/android/widget/OverScroller.java>
