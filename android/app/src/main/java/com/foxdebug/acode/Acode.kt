package com.foxdebug.acode

import android.app.Application

class Acode : Application() {
    companion object{
        lateinit var instance: Acode
            private set
    }
    override fun onCreate() {
        super.onCreate()
        instance = this
    }
}