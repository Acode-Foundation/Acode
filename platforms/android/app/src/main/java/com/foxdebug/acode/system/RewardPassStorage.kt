package com.foxdebug.acode.system

import org.json.JSONException
import org.json.JSONObject

internal object RewardPassStorage {
    @JvmStatic
    fun isUnchanged(raw: String?, state: JSONObject): Boolean {
        if (raw.isNullOrEmpty()) return false
        return try {
            val previous = JSONObject(raw)
            previous.length() == state.length() && state.keys().asSequence().all { key ->
                val old = previous.opt(key)
                val new = state.get(key)
                if (old is Number && new is Number) old.toString() == new.toString()
                else old == new
            }
        } catch (error: JSONException) {
            false
        }
    }
}
