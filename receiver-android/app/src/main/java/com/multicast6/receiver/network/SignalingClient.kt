package com.multicast6.receiver.network

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** HTTP long-poll client for the repository's versioned v1 signaling API. Media never uses this client. */
class SignalingClient(serverAddress: String) {
    private val baseUrl = normalizeServerAddress(serverAddress)

    fun createSession(): String {
        val response = request("POST", "/api/mirror/sessions")
        return response.getString("code")
    }

    fun join(code: String) {
        requirePairingCode(code)
        request("POST", "/api/mirror/sessions/$code/join")
    }

    fun send(code: String, role: String, message: JSONObject) {
        requirePairingCode(code)
        require(role == "sender" || role == "receiver") { "Invalid mirroring role." }
        message.put("protocolVersion", PROTOCOL_VERSION)
        request("POST", "/api/mirror/sessions/$code/messages?role=$role", message)
    }

    fun poll(code: String, role: String): List<JSONObject> {
        requirePairingCode(code)
        require(role == "sender" || role == "receiver") { "Invalid mirroring role." }
        val messages = request("GET", "/api/mirror/sessions/$code/messages?role=$role").optJSONArray("messages") ?: JSONArray()
        return (0 until messages.length()).mapNotNull { messages.optJSONObject(it) }
    }

    fun stop(code: String) {
        if (PAIRING_CODE.matches(code)) request("DELETE", "/api/mirror/sessions/$code")
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        connection.setRequestProperty("Accept", "application/json")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body.toString()) }
        }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val payload = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        connection.disconnect()
        val parsed = runCatching { JSONObject(payload) }.getOrElse { JSONObject() }
        if (status !in 200..299) throw IllegalStateException(parsed.optString("error").ifBlank { "Signaling server returned HTTP $status." })
        return parsed
    }

    companion object {
        const val PROTOCOL_VERSION = 1
        private val PAIRING_CODE = Regex("^[0-9]{6}$")

        fun normalizeServerAddress(value: String): String {
            val trimmed = value.trim().removeSuffix("/")
            val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
            val url = try { URL(withScheme) } catch (_: Exception) {
                throw IllegalArgumentException("Enter a valid Mac host and port, such as 192.168.1.25:3000.")
            }
            require(url.protocol == "http" || url.protocol == "https") { "Use an http:// or https:// signaling address." }
            require(!url.host.isNullOrBlank()) { "Enter the Mac's IP address or host name." }
            require(url.path.isNullOrEmpty() || url.path == "/") { "Enter the server address without a path." }
            require(url.query == null && url.ref == null && url.userInfo == null) { "Enter only the Mac host and port, without a path or extra URL fields." }
            require(url.port == -1 || url.port in 1..65535) { "Enter a valid server port." }
            return "${url.protocol}://${url.authority}"
        }

        fun requirePairingCode(code: String) {
            require(PAIRING_CODE.matches(code)) { "Enter the six-digit pairing code." }
        }
    }
}
