package com.foxdebug.acode.runtime

import com.foxdebug.iap.Iap

internal object ChannelServices : ServiceModule {
    override val services: List<ServiceDefinition> = listOf(
        ServiceDefinition(ServiceName.IAP) { Iap() },
    )
}
