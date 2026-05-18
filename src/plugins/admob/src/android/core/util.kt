package admob.plus.core

import admob.plus.cordova.ads.AdSizeType
import android.annotation.SuppressLint
import android.app.Activity
import android.content.res.Resources
import android.os.Bundle
import android.provider.Settings
import android.util.DisplayMetrics
import com.google.ads.mediation.admob.AdMobAdapter
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.security.MessageDigest
import java.security.NoSuchAlgorithmException
import java.util.Locale
import kotlin.math.roundToInt

fun buildAdRequest(opts: JSONObject): AdRequest {
    val builder = AdRequest.Builder()
    opts.optString("contentUrl", null)?.let {
        builder.setContentUrl(it)
    }
    val extras = Bundle().apply {
        opts.optString("npa", null)?.let { npa ->
            putString("npa", npa)
        }
    }
    return builder.addNetworkExtrasBundle(AdMobAdapter::class.java, extras).build()
}

fun buildAdSize(opts: JSONObject, activity: Activity): AdSize {
    val name = "size"
    if (!opts.has(name)) {
        return AdSize.SMART_BANNER
    }
    val adSizeObj = opts.optJSONObject(name)
    val adSize = AdSizeType.getAdSize(opts.optInt(name))
    if (adSizeObj == null) {
        return adSize ?: AdSize.SMART_BANNER
    }
    val adaptive = adSizeObj.optString("adaptive")
    val w =
        pxToDp(if (adSizeObj.has("width")) adSizeObj.optInt("width") else Resources.getSystem().displayMetrics.widthPixels)
    if ("inline" == adaptive) {
        if (adSizeObj.has("maxHeight")) {
            return AdSize.getInlineAdaptiveBannerAdSize(
                w,
                pxToDp(adSizeObj.optInt("maxHeight"))
            )
        }
    } else {
        return when (adSizeObj.optString("orientation")) {
            "portrait" -> AdSize.getPortraitAnchoredAdaptiveBannerAdSize(
                activity, w
            )

            "landscape" -> AdSize.getLandscapeAnchoredAdaptiveBannerAdSize(
                activity, w
            )

            else -> AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(
                activity, w
            )
        }
    }
    return AdSize(w, pxToDp(adSizeObj.optInt("height")))
}

fun optBooleanToInt(opts: JSONObject, name: String, vNull: Int, vTrue: Int, vFalse: Int): Int? {
    if (!opts.has(name)) return null
    if (opts.isNull(name)) return vNull
    return if (opts.optBoolean(name)) vTrue else vFalse
}

fun optFloat(opts: JSONObject, name: String): Float? {
    if (!opts.has(name) || opts.isNull(name)) return null
    return opts.optDouble(name).toFloat()
}

fun buildRequestConfiguration(opts: JSONObject): RequestConfiguration {
    val builder = RequestConfiguration.Builder()
    opts.optString("maxAdContentRating", null)?.let {
        builder.setMaxAdContentRating(it)
    }
    optBooleanToInt(
        opts,
        "tagForChildDirectedTreatment",
        RequestConfiguration.TAG_FOR_CHILD_DIRECTED_TREATMENT_UNSPECIFIED,
        RequestConfiguration.TAG_FOR_CHILD_DIRECTED_TREATMENT_TRUE,
        RequestConfiguration.TAG_FOR_CHILD_DIRECTED_TREATMENT_FALSE
    )?.let {
        builder.setTagForChildDirectedTreatment(it)
    }
    optBooleanToInt(
        opts,
        "tagForUnderAgeOfConsent",
        RequestConfiguration.TAG_FOR_UNDER_AGE_OF_CONSENT_UNSPECIFIED,
        RequestConfiguration.TAG_FOR_UNDER_AGE_OF_CONSENT_TRUE,
        RequestConfiguration.TAG_FOR_UNDER_AGE_OF_CONSENT_FALSE
    )?.let {
        builder.setTagForUnderAgeOfConsent(it)
    }
    if (opts.has("testDeviceIds")) {
        builder.setTestDeviceIds(jsonArray2stringList(opts.optJSONArray("testDeviceIds")))
    }
    return builder.build()
}

fun configForTestLabIfNeeded(activity: Activity) {
    if (!isRunningInTestLab(activity)) {
        return
    }
    val config = MobileAds.getRequestConfiguration()
    val testDeviceIds = config.testDeviceIds
    val deviceId = computeDeviceID(activity)
    if (deviceId in testDeviceIds) {
        return
    }
    testDeviceIds.add(deviceId)
    val builder = config.toBuilder()
    builder.setTestDeviceIds(testDeviceIds)
    MobileAds.setRequestConfiguration(builder.build())
}

fun computeDeviceID(activity: Activity): String {
    // This will request test ads on the emulator and device by passing this hashed device ID.
    @SuppressLint("HardwareIds") val androidID = Settings.Secure.getString(
        activity.contentResolver, Settings.Secure.ANDROID_ID
    )
    return md5(androidID).uppercase(Locale.getDefault())
}

fun isRunningInTestLab(activity: Activity): Boolean {
    val testLabSetting =
        Settings.System.getString(activity.contentResolver, "firebase.test.lab")
    return "true" == testLabSetting
}

fun dpToPx(dp: Double): Double {
    return dp * Resources.getSystem().displayMetrics.density
}

fun pxToDp(px: Int): Int {
    val displayMetrics = Resources.getSystem().displayMetrics
    return (px / (displayMetrics.xdpi / DisplayMetrics.DENSITY_DEFAULT)).roundToInt()
}

fun jsonArray2stringList(a: JSONArray?): List<String> {
    val result: MutableList<String> = ArrayList()
    a?.let {
        for (i in 0 until it.length()) {
            it.optString(i)?.let { id ->
                result.add(id)
            }
        }
    }
    return result
}

fun md5(s: String): String {
    try {
        val digest = MessageDigest.getInstance("MD5")
        digest.update(s.toByteArray())
        val bigInt = BigInteger(1, digest.digest())
        return String.format("%32s", bigInt.toString(16)).replace(' ', '0')
    } catch (ignore: NoSuchAlgorithmException) {
    }
    return ""
}
