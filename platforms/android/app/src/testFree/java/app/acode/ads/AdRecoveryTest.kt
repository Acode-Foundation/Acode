package app.acode.ads

import androidx.activity.ComponentActivity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class AdRecoveryTest {
    @Test
    fun missingAdIsRecoverableOnlyWhenTheHostHasResumedAndRegainedFocus() {
        val controller = Robolectric.buildActivity(RecoveryActivity::class.java).setup()
        val activity = controller.get()
        try {
            assertFalse(recoverAdPresentation(activity, "removed-ad"))
            activity.focused = true
            assertTrue(recoverAdPresentation(activity, "removed-ad"))
            controller.pause()
            assertFalse(recoverAdPresentation(activity, "removed-ad"))
            controller.resume()
            assertTrue(recoverAdPresentation(activity, "removed-ad"))
            activity.finish()
            assertFalse(recoverAdPresentation(activity, "removed-ad"))
        } finally {
            controller.pause().stop().destroy()
        }
    }

    class RecoveryActivity : ComponentActivity() {
        var focused = false
        override fun hasWindowFocus(): Boolean = focused
    }
}
