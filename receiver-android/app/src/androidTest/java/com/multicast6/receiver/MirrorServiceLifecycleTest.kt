package com.multicast6.receiver

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.ServiceTestRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.webrtc.VideoTrack

@RunWith(AndroidJUnit4::class)
class MirrorServiceLifecycleTest {
    @get:Rule val serviceRule = ServiceTestRule()

    @Test fun serviceBindsWithoutStartingCaptureAndTearsDownIdleSession() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val binder = serviceRule.bindService(Intent(context, MirrorService::class.java)) as MirrorService.LocalBinder
        val service = binder.service
        var initialStatus = ""
        service.addUiListener(object : MirrorService.UiListener {
            override fun onStatus(message: String, code: String?, error: Boolean) { initialStatus = message }
            override fun onRemoteVideo(track: VideoTrack?) = Unit
            override fun onSessionEnded() = Unit
        })

        assertEquals("Ready. Choose whether to send or receive a screen.", initialStatus)
        service.setRemoteSink(null)
        service.stopSession(deleteRemoteSession = false)
    }
}
