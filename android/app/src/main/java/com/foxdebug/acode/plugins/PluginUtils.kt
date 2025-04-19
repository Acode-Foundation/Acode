package com.foxdebug.acode.plugins

import com.getcapacitor.PluginCall

inline fun PluginCall.autoRejectOnError(onFailure:(Throwable?)-> Unit, invoke:()-> Unit){
    runCatching {
        invoke()
    }.onFailure {
        it.printStackTrace()
        reject("Unknown Exception \nMessage: ${it.message}\n${it.stackTraceToString()}")
        onFailure(it)
    }
}

inline fun PluginCall.exists(key: String,onFailure:(()-> Unit) = {},onSuccess:(()-> Unit) = {}){
    if (data.has(key).not()){
        reject("$key is not set")
        onFailure.invoke()
    }else{
        onSuccess.invoke()
    }
}

inline fun PluginCall.existsNot(key: String,onFailure:(()-> Unit) = {}){
    if (data.has(key).not()){
        reject("$key is not set")
        onFailure.invoke()
    }
}