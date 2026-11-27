package com.foxdebug.acode.runtime

import android.util.Base64
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

class Payload @JvmOverloads constructor(
    private val status: Status,
    private val data: Any? = STATUS_MESSAGES[status.ordinal]
) {
    enum class Status {
        NO_RESULT,
        OK,
        CLASS_NOT_FOUND_EXCEPTION,
        ILLEGAL_ACCESS_EXCEPTION,
        INSTANTIATION_EXCEPTION,
        MALFORMED_URL_EXCEPTION,
        IO_EXCEPTION,
        INVALID_ACTION,
        JSON_EXCEPTION,
        ERROR,
    }

    var keepCallback: Boolean = false

    constructor(status: Status, data: ByteArray?, binaryString: Boolean) : this(
        status,
        encodeBinary(data, binaryString)
    )

    constructor(data: Any?) : this(Status.OK, data)

    fun getStatus(): Int {
        return status.ordinal
    }

    @Throws(JSONException::class)
    fun toJSON(id: Long, generation: Long): JSONObject {
        val result = JSONObject()
        result.put("id", id)
        result.put("generation", generation)
        result.put("type", if (status == Status.OK) 0 else 1)
        result.put("status", status.ordinal)
        result.put("keep", this.keepCallback)
        result.put("data", encode(data))
        return result
    }

    companion object {
        const val MESSAGE_TYPE_STRING: Int = 1
        const val MESSAGE_TYPE_ARRAYBUFFER: Int = 6
        const val MESSAGE_TYPE_BINARYSTRING: Int = 7

        private val STATUS_MESSAGES = arrayOf<String?>(
            "No result",
            "OK",
            "Class not found",
            "Illegal access",
            "Instantiation error",
            "Malformed url",
            "IO error",
            "Invalid action",
            "JSON error",
            "Error",
        )

        @Throws(JSONException::class)
        private fun encode(value: Any?): Any {
            if (value == null) return JSONObject.NULL
            if (value is ByteArray) return encodeBinary(value, false)
            if (value is MutableList<*>) {
                val parts = JSONArray()
                for (part in value) parts.put(encode((part as Payload).data))
                return JSONObject().put("kind", "multipart").put("data", parts)
            }
            return value
        }

        private fun encodeBinary(bytes: ByteArray?, binaryString: Boolean): JSONObject {
            try {
                return JSONObject()
                    .put("kind", if (binaryString) "binaryString" else "arrayBuffer")
                    .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            } catch (exception: JSONException) {
                throw IllegalArgumentException(exception)
            }
        }
    }
}
