package admob.plus.cordova

import admob.plus.core.jsonArray2stringList
import android.content.pm.ApplicationInfo
import com.google.android.ump.ConsentDebugSettings
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import org.json.JSONObject

internal data class PrivacyConsentState(
    val consentStatus: String,
    val canRequestAds: Boolean,
    val privacyOptionsRequired: Boolean,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "consentStatus" to consentStatus,
        "canRequestAds" to canRequestAds,
        "privacyOptionsRequired" to privacyOptionsRequired,
    )
}

internal fun consentStatusName(status: Int): String = when (status) {
    ConsentInformation.ConsentStatus.REQUIRED -> "required"
    ConsentInformation.ConsentStatus.NOT_REQUIRED -> "notRequired"
    ConsentInformation.ConsentStatus.OBTAINED -> "obtained"
    else -> "unknown"
}

internal fun isPrivacyOptionsRequired(
    status: ConsentInformation.PrivacyOptionsRequirementStatus
): Boolean =
    status == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

internal fun requireDebugBuild(debuggable: Boolean, hasDebugOptions: Boolean) {
    if (hasDebugOptions && !debuggable) {
        throw IllegalStateException("UMP debug controls are unavailable in release builds")
    }
}

internal class Privacy(private val plugin: AdMob) {
    private val consentInformation: ConsentInformation by lazy {
        UserMessagingPlatform.getConsentInformation(plugin.activity)
    }

    fun gatherConsent(ctx: ExecuteContext) {
        plugin.activity.runOnUiThread {
            val parameters = try {
                buildRequestParameters(ctx.opts)
            } catch (error: IllegalArgumentException) {
                return@runOnUiThread ctx.reject(error.message)
            } catch (error: IllegalStateException) {
                return@runOnUiThread ctx.reject(error.message)
            }

            consentInformation.requestConsentInfoUpdate(
                plugin.activity,
                parameters,
                {
                    UserMessagingPlatform.loadAndShowConsentFormIfRequired(
                        plugin.activity
                    ) { formError ->
                        if (formError != null) {
                            ctx.reject("UMP ${formError.errorCode}: ${formError.message}")
                        } else {
                            ctx.resolve(currentState().toMap())
                        }
                    }
                },
                { requestError ->
                    ctx.reject("UMP ${requestError.errorCode}: ${requestError.message}")
                },
            )
        }
    }

    fun getState(ctx: ExecuteContext) {
        ctx.resolve(currentState().toMap())
    }

    fun showOptions(ctx: ExecuteContext) {
        plugin.activity.runOnUiThread {
            UserMessagingPlatform.showPrivacyOptionsForm(plugin.activity) { formError ->
                if (formError != null) {
                    ctx.reject("UMP ${formError.errorCode}: ${formError.message}")
                } else {
                    ctx.resolve(currentState().toMap())
                }
            }
        }
    }

    fun resetForTesting(ctx: ExecuteContext) {
        try {
            requireDebugBuild(isAppDebuggable(), hasDebugOptions = true)
        } catch (error: IllegalStateException) {
            return ctx.reject(error.message)
        }
        consentInformation.reset()
        ctx.resolve()
    }

    private fun currentState() = PrivacyConsentState(
        consentStatus = consentStatusName(consentInformation.consentStatus),
        canRequestAds = consentInformation.canRequestAds(),
        privacyOptionsRequired = isPrivacyOptionsRequired(
            consentInformation.privacyOptionsRequirementStatus
        ),
    )

    private fun buildRequestParameters(opts: JSONObject): ConsentRequestParameters {
        val debugGeography = opts.optString("debugGeography", "disabled")
        val testDeviceIds = jsonArray2stringList(opts.optJSONArray("testDeviceIds"))
        val hasDebugOptions = debugGeography != "disabled" || testDeviceIds.isNotEmpty()
        requireDebugBuild(isAppDebuggable(), hasDebugOptions)

        val builder = ConsentRequestParameters.Builder()
        if (hasDebugOptions) {
            val debugBuilder = ConsentDebugSettings.Builder(plugin.activity)
            val geography = when (debugGeography) {
                "disabled" ->
                    ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_DISABLED

                "eea" ->
                    ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA

                "notEea" ->
                    ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_NOT_EEA

                else -> throw IllegalArgumentException(
                    "Unsupported UMP debug geography: $debugGeography"
                )
            }
            debugBuilder.setDebugGeography(geography)
            testDeviceIds.forEach(debugBuilder::addTestDeviceHashedId)
            builder.setConsentDebugSettings(debugBuilder.build())
        }
        return builder.build()
    }

    private fun isAppDebuggable(): Boolean =
        plugin.activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
}
