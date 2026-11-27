package com.foxdebug.acode.runtime

/** Transport keys the JavaScript bridge uses to address native services. */
enum class ServiceName(val key: String) {
    AD_MOB("AdMob"),
    AUTHENTICATOR("Authenticator"),
    BROWSER("Browser"),
    CLIPBOARD("Clipboard"),
    NATIVE_HTTP("NativeHttpPlugin"),
    BUILD_INFO("BuildInfo"),
    CRASH_HANDLER("CrashHandler"),
    CUSTOM_TABS("CustomTabs"),
    DEVICE("Device"),
    FILE("File"),
    FTP("Ftp"),
    IAP("Iap"),
    TEE("Tee"),
    SD_CARD("SDcard"),
    SERVER("Server"),
    SFTP("Sftp"),
    SYSTEM("System"),
    EXECUTOR("Executor"),
    BACKGROUND_EXECUTOR("BackgroundExecutor"),
    WEB_SOCKET("WebSocketPlugin"),
    ACODE_WEB_VIEW("AcodeWebView"),
    APP("App"),
    SYSTEM_BAR("SystemBarPlugin");

}
