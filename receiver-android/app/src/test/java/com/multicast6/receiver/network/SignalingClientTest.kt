package com.multicast6.receiver.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SignalingClientTest {
    @Test fun normalizesMacHostToBackendUrl() {
        assertEquals("http://192.168.1.20:3000", SignalingClient.normalizeServerAddress("192.168.1.20:3000/"))
        assertEquals("https://mac.local:3000", SignalingClient.normalizeServerAddress("https://mac.local:3000"))
    }

    @Test fun rejectsBlankOrPathBasedServerAddress() {
        assertThrows(IllegalArgumentException::class.java) { SignalingClient.normalizeServerAddress("") }
        assertThrows(IllegalArgumentException::class.java) { SignalingClient.normalizeServerAddress("mac.local/api") }
    }

    @Test fun requiresSixDigitPairingCode() {
        SignalingClient.requirePairingCode("123456")
        assertThrows(IllegalArgumentException::class.java) { SignalingClient.requirePairingCode("12345") }
        assertThrows(IllegalArgumentException::class.java) { SignalingClient.requirePairingCode("12ab56") }
    }
}
