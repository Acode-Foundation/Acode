package admob.plus.cordova.ads

import admob.plus.core.pxToDp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BannerLayoutTest {
    @Test
    fun convertsPixelsUsingLogicalDisplayDensity() {
        assertEquals(360, pxToDp(1080, 3f))
        assertEquals(393, pxToDp(1080, 2.75f))
        assertEquals(1080, pxToDp(1080, 0f))
    }

    @Test
    fun reservesOnlyTheMeasuredLoadedBannerHeight() {
        assertEquals(
            74,
            resolveBannerBottomMargin(
                originalMargin = 8,
                requestedVisible = true,
                loaded = true,
                measuredHeight = 66,
            ),
        )
    }

    @Test
    fun preservesTheOriginalMarginUntilTheBannerCanDisplay() {
        assertEquals(
            8,
            resolveBannerBottomMargin(
                originalMargin = 8,
                requestedVisible = true,
                loaded = false,
                measuredHeight = 66,
            ),
        )
        assertEquals(
            8,
            resolveBannerBottomMargin(
                originalMargin = 8,
                requestedVisible = false,
                loaded = true,
                measuredHeight = 66,
            ),
        )
    }

    @Test
    fun clampsInvalidMeasuredHeights() {
        assertEquals(
            8,
            resolveBannerBottomMargin(
                originalMargin = 8,
                requestedVisible = true,
                loaded = true,
                measuredHeight = -20,
            ),
        )
    }

    @Test
    fun followsMeasuredHeightChangesAfterRotation() {
        assertEquals(
            58,
            resolveBannerBottomMargin(8, true, true, 50),
        )
        assertEquals(
            98,
            resolveBannerBottomMargin(8, true, true, 90),
        )
    }

    @Test
    fun keepsAnInitiallyLoadingVisibleBannerActive() {
        val lifecycle = BannerLifecycle()

        assertTrue(lifecycle.requestLoad())
        assertFalse(lifecycle.requestShow())
        assertEquals(BannerLoadState.LOADING, lifecycle.loadState)
        assertTrue(lifecycle.shouldKeepActive)
        assertFalse(lifecycle.shouldDisplay)
    }

    @Test
    fun ignoresRepeatedLoadAndShowRequests() {
        val lifecycle = BannerLifecycle()

        assertTrue(lifecycle.requestLoad())
        assertFalse(lifecycle.requestLoad())
        assertFalse(lifecycle.requestShow())
        assertFalse(lifecycle.requestShow())
        assertEquals(BannerLoadState.LOADING, lifecycle.loadState)
    }

    @Test
    fun displaysOnlyAfterTheRequestedBannerLoads() {
        val lifecycle = BannerLifecycle()

        assertTrue(lifecycle.requestShow())
        assertFalse(lifecycle.shouldDisplay)

        lifecycle.markLoaded()

        assertTrue(lifecycle.isLoaded)
        assertTrue(lifecycle.shouldDisplay)
        assertTrue(lifecycle.shouldKeepActive)
    }

    @Test
    fun remainsHiddenWhenLoadingCompletesAfterHide() {
        val lifecycle = BannerLifecycle()

        lifecycle.requestShow()
        lifecycle.requestHide()
        assertFalse(lifecycle.shouldKeepActive)

        lifecycle.markLoaded()

        assertTrue(lifecycle.isLoaded)
        assertFalse(lifecycle.shouldDisplay)
        assertFalse(lifecycle.shouldKeepActive)
    }

    @Test
    fun retriesAFailedLoadOnTheNextLoadOrShow() {
        val lifecycle = BannerLifecycle()

        lifecycle.requestShow()
        lifecycle.markFailed()
        assertEquals(BannerLoadState.FAILED, lifecycle.loadState)
        assertFalse(lifecycle.shouldDisplay)
        assertFalse(lifecycle.shouldKeepActive)

        assertTrue(lifecycle.requestLoad())
        assertEquals(BannerLoadState.LOADING, lifecycle.loadState)
        assertTrue(lifecycle.shouldKeepActive)
    }

    @Test
    fun preservesVisibilityIntentDuringRotationReload() {
        val lifecycle = BannerLifecycle()

        lifecycle.requestShow()
        lifecycle.markLoaded()
        lifecycle.restartLoad()

        assertTrue(lifecycle.requestedVisible)
        assertEquals(BannerLoadState.LOADING, lifecycle.loadState)
        assertTrue(lifecycle.shouldKeepActive)
        assertFalse(lifecycle.shouldDisplay)
    }
}
