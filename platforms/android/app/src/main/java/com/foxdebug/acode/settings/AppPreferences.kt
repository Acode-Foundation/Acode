package com.foxdebug.acode.settings

import android.content.Context
import android.content.SharedPreferences
import com.foxdebug.acode.runtime.RuntimeBaseApplication
import androidx.core.content.edit

object AppPreferences {
	//do not change this name
	private const val PREFERENCES_NAME = "Settings"

	private val preferences: SharedPreferences by lazy {
		val application = RuntimeBaseApplication.instance
			?: error("AppPreferences requires RuntimeBaseApplication to be initialized")
		application.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
	}

	fun set(name: String, value: String?) {
		preferences.edit { putString(name, value) }
	}

	fun set(name: String, value: Boolean) {
		preferences.edit { putBoolean(name, value) }
	}

	fun set(name: String, value: Int) {
		preferences.edit { putInt(name, value) }
	}

	fun set(name: String, value: Long) {
		preferences.edit { putLong(name, value) }
	}

	fun set(name: String, value: Float) {
		preferences.edit { putFloat(name, value) }
	}

	fun set(name: String, value: Set<String>) {
		preferences.edit { putStringSet(name, value) }
	}

	fun getString(name: String, defaultValue: String? = null): String? =
		preferences.getString(name, defaultValue)

	fun getBoolean(name: String, defaultValue: Boolean = false): Boolean =
		preferences.getBoolean(name, defaultValue)

	fun getInteger(name: String, defaultValue: Int = 0): Int =
		preferences.getInt(name, defaultValue)

	fun getLong(name: String, defaultValue: Long = 0L): Long =
		preferences.getLong(name, defaultValue)

	fun getFloat(name: String, defaultValue: Float = 0f): Float =
		preferences.getFloat(name, defaultValue)

	fun getStringSet(name: String, defaultValue: Set<String> = emptySet()): Set<String> =
		preferences.getStringSet(name, defaultValue) ?: defaultValue

	fun contains(name: String): Boolean = preferences.contains(name)

	fun remove(name: String) {
		preferences.edit { remove(name) }
	}

	fun clear() {
		preferences.edit { clear() }
	}

	fun registerChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
		preferences.registerOnSharedPreferenceChangeListener(listener)
	}

	fun unregisterChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
		preferences.unregisterOnSharedPreferenceChangeListener(listener)
	}

	val all: Map<String, *>
		get() = preferences.all
}
