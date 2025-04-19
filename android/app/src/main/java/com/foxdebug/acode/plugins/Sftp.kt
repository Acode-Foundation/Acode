package com.foxdebug.acode.plugins

import android.util.Log
import com.foxdebug.acode.MainActivity
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.sshtools.client.SshClient
import com.sshtools.client.SshClient.SshClientBuilder
import com.sshtools.client.sftp.SftpClient
import com.sshtools.client.sftp.SftpClient.SftpClientBuilder
import com.sshtools.common.permissions.PermissionDeniedException
import com.sshtools.common.publickey.InvalidPassphraseException
import com.sshtools.common.ssh.components.jce.JCEProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.nio.channels.UnresolvedAddressException


@CapacitorPlugin(name = "Sftp")
class Sftp : Plugin() {
    private val TAG = "SFTP"
    private var ssh: SshClient? = null
    private var connectionID: String? = null
    private var sftp: SftpClient? = null


    override fun load() {
        super.load()
        System.setProperty("maverick.log.nothread", "true")
    }

    @PluginMethod
    fun connectUsingPassword(call: PluginCall) = with(call) {

        existsNot("host") {
            return@with
        }
        existsNot("port") {
            return@with
        }
        existsNot("username") {
            return@with
        }
        existsNot("password") {
            return@with
        }

        val host = call.getString("host")!!
        val port = call.getInt("port")!!
        val username = call.getString("username")!!
        val password = call.getString("password")!!

        MainActivity.lifeCycleScope.launch(Dispatchers.IO) {
            try {
                JCEProvider.enableBouncyCastle(true)
                Log.d(TAG, "Connecting to $host:$port as $username")
                ssh = SshClientBuilder.create()
                    .withHostname(host)
                    .withPort(port)
                    .withUsername(username)
                    .withPassword(password)
                    .build()


                if (ssh!!.isConnected) {
                    connectionID = "$username@$host"
                    runCatching {
                        sftp = SftpClientBuilder.create().withClient(ssh).build()
                    }.onFailure {
                        it.printStackTrace()
                        ssh?.close()
                        call.reject("Failed to initialize SFTP subsystem: ${it.message.toString()}")
                        return@launch
                    }

                    runCatching {
                        sftp?.subsystemChannel?.setCharsetEncoding("UTF-8")
                    }.onFailure {
                        Log.w(TAG, "Failed to set UTF-8 encoding, falling back to default", it)
                    }

                    Log.d(TAG, "Connected successfully to $connectionID")
                    call.resolve()
                } else {
                    call.reject("Failed to connect to $connectionID")
                    //ssh?.close()
                }
            } catch (e: Exception) {
                e.printStackTrace()
                when (e) {
                    is UnresolvedAddressException -> {
                        call.reject("Cannot resolve host address")
                    }

                    is PermissionDeniedException -> {
                        call.reject("Authentication failed: ${e.message}")
                    }

                    is InvalidPassphraseException -> {
                        call.reject("Invalid passphrase for $connectionID")
                    }

                    else -> {
                        call.reject("Unknown error ${e.message}")
                    }
                }
            }

        }
    }
}














