/*
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/
package com.foxdebug.acode.runtime

import java.lang.Long
import kotlin.Boolean
import kotlin.Double
import kotlin.Int
import kotlin.String

class Preferences {
    private val prefs = HashMap<String?, String?>(20)

    fun set(name: String, value: String?) {
        prefs[name.lowercase()] = value
    }

    fun set(name: String, value: Boolean) {
        set(name, "" + value)
    }

    fun set(name: String, value: Int) {
        set(name, "" + value)
    }

    fun set(name: String, value: Double) {
        set(name, "" + value)
    }

    val all: MutableMap<String?, String?>
        get() = prefs

    fun getBoolean(name: String, defaultValue: Boolean): Boolean {
        var name = name
        name = name.lowercase()
        val value = prefs.get(name)
        if (value != null) {
            return value.toBoolean()
        }
        return defaultValue
    }

    // Added in 4.0.0
    fun contains(name: String): Boolean {
        return getString(name, null) != null
    }

    fun getInteger(name: String, defaultValue: Int): Int {
        var name = name
        name = name.lowercase()
        val value = prefs[name]
        if (value != null) {
            // Some 32-bit hex values (for example, 0x80000000) are valid int bit patterns
            // but exceed Integer.MAX_VALUE when read as positive numbers. Integer.decode()
            // rejects such values with NumberFormatException, so decode as long first and
            // cast to int to preserve the intended 32-bit value.
            return (Long.decode(value) as kotlin.Long).toInt()
        }
        return defaultValue
    }

    fun getDouble(name: String, defaultValue: Double): Double {
        var name = name
        name = name.lowercase()
        val value = prefs[name]
        if (value != null) {
            return value.toDouble()
        }
        return defaultValue
    }

    fun getString(name: String, defaultValue: String?): String? {
        var name = name
        name = name.lowercase()
        val value = prefs[name]
        if (value != null) {
            return value
        }
        return defaultValue
    }
}
