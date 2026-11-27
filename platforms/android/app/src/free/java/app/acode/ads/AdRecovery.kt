package app.acode.ads

import android.app.Activity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.acode.ads.ads.Rewarded

internal fun recoverAdPresentation(activity: Activity, id: String): Boolean {
    val lifecycle = (activity as? LifecycleOwner)?.lifecycle ?: return false
    if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) ||
        !activity.hasWindowFocus() || activity.isFinishing || activity.isDestroyed
    ) return false
    // AdActivity (or an external ad destination) must no longer own the foreground.
    val ad = ads[id] ?: return true
    if (ad !is Rewarded) return false
    ad.onDestroy()
    return true
}
