package com.foxdebug.acode.runtime

import app.acode.ads.AdMob

internal object EditionServices : ServiceModule {
    override val services: List<ServiceDefinition> = listOf(
        ServiceDefinition(ServiceName.AD_MOB) { AdMob() },
    )
}
