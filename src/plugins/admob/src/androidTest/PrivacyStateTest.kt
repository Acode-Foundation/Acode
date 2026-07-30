package admob.plus.cordova

import com.google.android.ump.ConsentInformation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivacyStateTest {
    @Test
    fun mapsConsentStatuses() {
        assertEquals(
            "required",
            consentStatusName(ConsentInformation.ConsentStatus.REQUIRED),
        )
        assertEquals(
            "notRequired",
            consentStatusName(ConsentInformation.ConsentStatus.NOT_REQUIRED),
        )
        assertEquals(
            "obtained",
            consentStatusName(ConsentInformation.ConsentStatus.OBTAINED),
        )
        assertEquals(
            "unknown",
            consentStatusName(ConsentInformation.ConsentStatus.UNKNOWN),
        )
        assertEquals("unknown", consentStatusName(Int.MAX_VALUE))
    }

    @Test
    fun mapsPrivacyOptionsRequirement() {
        assertTrue(
            isPrivacyOptionsRequired(
                ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
            )
        )
        assertFalse(
            isPrivacyOptionsRequired(
                ConsentInformation.PrivacyOptionsRequirementStatus.NOT_REQUIRED
            )
        )
        assertFalse(
            isPrivacyOptionsRequired(
                ConsentInformation.PrivacyOptionsRequirementStatus.UNKNOWN
            )
        )
    }

    @Test
    fun permitsDebugControlsOnlyInDebuggableBuilds() {
        requireDebugBuild(debuggable = true, hasDebugOptions = true)
        requireDebugBuild(debuggable = false, hasDebugOptions = false)

        assertThrows(IllegalStateException::class.java) {
            requireDebugBuild(debuggable = false, hasDebugOptions = true)
        }
    }

    @Test
    fun serializesStablePublicState() {
        assertEquals(
            mapOf(
                "consentStatus" to "obtained",
                "canRequestAds" to true,
                "privacyOptionsRequired" to true,
            ),
            PrivacyConsentState(
                consentStatus = "obtained",
                canRequestAds = true,
                privacyOptionsRequired = true,
            ).toMap(),
        )
    }
}
