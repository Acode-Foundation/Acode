package com.foxdebug.acode.runtime

/** Creates one instance of the service bound to a [ServiceName]. */
fun interface ServiceFactory {
    fun create(): Service
}

/** Binds a transport name to the class serving it, so no lookup happens at runtime. */
class ServiceDefinition(
    val name: ServiceName,
    val loadOnStart: Boolean = false,
    val factory: ServiceFactory,
)

/** Services a build variant contributes on top of the shared catalogue. */
interface ServiceModule {
    val services: List<ServiceDefinition>
}
