package app.acode.ads

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdDispatchTest {
    @Test
    fun permitsBannersToReceiveShowWhileLoading() {
        assertTrue(
            shouldDispatchAdShow(
                isLoaded = false,
                canShowWhileLoading = true,
            ),
        )
    }

    @Test
    fun keepsOtherAdFormatsLoadedOnly() {
        assertFalse(
            shouldDispatchAdShow(
                isLoaded = false,
                canShowWhileLoading = false,
            ),
        )
        assertTrue(
            shouldDispatchAdShow(
                isLoaded = true,
                canShowWhileLoading = false,
            ),
        )
    }
}
