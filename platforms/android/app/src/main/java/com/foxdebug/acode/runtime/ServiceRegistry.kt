package com.foxdebug.acode.runtime

import com.foxdebug.acode.auth.Authenticator
import com.foxdebug.acode.browser.Plugin
import com.foxdebug.acode.buildinfo.BuildInfo
import com.foxdebug.acode.crashhandler.CrashHandler
import com.foxdebug.acode.customtabs.CustomTabsPlugin
import com.foxdebug.acode.device.Device
import com.foxdebug.acode.file.FileUtils
import com.foxdebug.acode.ftp.Ftp
import com.foxdebug.acode.http.NativeHttpPlugin
import com.foxdebug.acode.sdcard.SDcard
import com.foxdebug.acode.security.Tee
import com.foxdebug.acode.server.Server
import com.foxdebug.acode.sftp.Sftp
import com.foxdebug.acode.system.System as SystemService
import com.foxdebug.acode.terminal.BackgroundExecutor
import com.foxdebug.acode.terminal.Executor
import com.foxdebug.acode.websocket.WebSocketPlugin
import com.foxdebug.acode.webview.WebViewPlugin
import com.verso.clipboard.Clipboard

object ServiceRegistry {
    private val mainServices: List<ServiceDefinition> = listOf(
        ServiceDefinition(ServiceName.AUTHENTICATOR, loadOnStart = true) { Authenticator() },
        ServiceDefinition(ServiceName.BROWSER) { Plugin() },
        ServiceDefinition(ServiceName.CLIPBOARD) { Clipboard() },
        ServiceDefinition(ServiceName.NATIVE_HTTP) { NativeHttpPlugin() },
        ServiceDefinition(ServiceName.BUILD_INFO) { BuildInfo() },
        ServiceDefinition(ServiceName.CRASH_HANDLER, loadOnStart = true) { CrashHandler() },
        ServiceDefinition(ServiceName.CUSTOM_TABS) { CustomTabsPlugin() },
        ServiceDefinition(ServiceName.DEVICE) { Device() },
        ServiceDefinition(ServiceName.FILE, loadOnStart = true) { FileUtils() },
        ServiceDefinition(ServiceName.FTP) { Ftp() },
        ServiceDefinition(ServiceName.TEE) { Tee() },
        ServiceDefinition(ServiceName.SD_CARD) { SDcard() },
        ServiceDefinition(ServiceName.SERVER) { Server() },
        ServiceDefinition(ServiceName.SFTP) { Sftp() },
        ServiceDefinition(ServiceName.SYSTEM) { SystemService() },
        ServiceDefinition(ServiceName.EXECUTOR) { Executor() },
        ServiceDefinition(ServiceName.BACKGROUND_EXECUTOR) { BackgroundExecutor() },
        ServiceDefinition(ServiceName.WEB_SOCKET) { WebSocketPlugin() },
        ServiceDefinition(ServiceName.ACODE_WEB_VIEW) { WebViewPlugin() },
        ServiceDefinition(ServiceName.APP) { App() },
        ServiceDefinition(ServiceName.SYSTEM_BAR, loadOnStart = true) { SystemBarPlugin() },
    )

    val definitions: List<ServiceDefinition> =
        mainServices + EditionServices.services + ChannelServices.services
}
