package com.multicast6.receiver

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.drawable.Icon
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import org.webrtc.EglBase
import org.webrtc.VideoSink
import org.webrtc.VideoTrack

class MirrorService : Service(), MirrorEngine.Listener {
    interface UiListener {
        fun onStatus(message: String, code: String?, error: Boolean)
        fun onRemoteVideo(track: VideoTrack?)
        fun onSessionEnded()
    }

    inner class LocalBinder : Binder() {
        val service: MirrorService get() = this@MirrorService
    }

    private val binder = LocalBinder()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = linkedSetOf<UiListener>()
    private lateinit var engine: MirrorEngine
    private var latestStatus = "Ready. Choose whether to send or receive a screen."
    private var latestCode: String? = null
    private var latestError = false
    private var startedAsSender = false

    val eglContext: EglBase.Context get() = engine.eglContext

    override fun onCreate() {
        super.onCreate()
        engine = MirrorEngine(this, this)
        createNotificationChannel()
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_SEND -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                val resultData = projectionResultData(intent)
                val server = intent.getStringExtra(EXTRA_SERVER).orEmpty()
                if (resultData == null) {
                    onStatus("Android screen-sharing consent was not received. Tap Send Screen to Mac and allow the system prompt.", null, true)
                    stopSelf(startId)
                    return START_NOT_STICKY
                }
                try {
                    startAsProjectionForeground()
                    startedAsSender = true
                    engine.startSending(server, resultCode, resultData)
                } catch (error: Exception) {
                    onStatus("Could not start the screen-sharing service: ${error.message}", null, true)
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf(startId)
                }
            }
            ACTION_RECEIVE -> {
                val server = intent.getStringExtra(EXTRA_SERVER).orEmpty()
                val code = intent.getStringExtra(EXTRA_CODE).orEmpty()
                startedAsSender = false
                engine.startReceiving(server, code)
            }
            ACTION_STOP -> stopSession(deleteRemoteSession = true)
        }
        return START_NOT_STICKY
    }

    private fun startAsProjectionForeground() {
        val notification = buildNotification()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    }

    private fun projectionResultData(intent: Intent): Intent? = if (Build.VERSION.SDK_INT >= 33) {
        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
    } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Screen sharing", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while this device is sharing its screen"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, MirrorService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(this, 5, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("MultiCast 6 is sharing your screen")
            .setContentText("Tap Stop to end Android screen capture")
            .setOngoing(true)
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_pause), "Stop sharing", stopPending).build())
            .build()
    }

    fun addUiListener(listener: UiListener) {
        listeners += listener
        listener.onStatus(latestStatus, latestCode, latestError)
    }

    fun removeUiListener(listener: UiListener) {
        listeners -= listener
    }

    fun setRemoteSink(sink: VideoSink?) = engine.setRemoteSink(sink)

    fun resizeCapture() = engine.resizeCapture()

    fun stopSession(deleteRemoteSession: Boolean) {
        engine.stopSession(deleteRemoteSession)
        if (startedAsSender) stopForeground(STOP_FOREGROUND_REMOVE)
        startedAsSender = false
        stopSelf()
    }

    override fun onStatus(message: String, code: String?, error: Boolean) {
        mainHandler.post {
            latestStatus = message
            latestCode = code
            latestError = error
            listeners.toList().forEach { it.onStatus(message, code, error) }
        }
    }

    override fun onRemoteVideo(track: VideoTrack?) {
        mainHandler.post { listeners.toList().forEach { it.onRemoteVideo(track) } }
    }

    override fun onSessionEnded() {
        mainHandler.post {
            if (startedAsSender) stopForeground(STOP_FOREGROUND_REMOVE)
            startedAsSender = false
            listeners.toList().forEach { it.onSessionEnded() }
            stopSelf()
        }
    }

    override fun onDestroy() {
        engine.dispose()
        super.onDestroy()
    }

    companion object {
        const val ACTION_SEND = "com.multicast6.receiver.SEND"
        const val ACTION_RECEIVE = "com.multicast6.receiver.RECEIVE"
        const val ACTION_STOP = "com.multicast6.receiver.STOP"
        const val EXTRA_SERVER = "server"
        const val EXTRA_CODE = "code"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        private const val NOTIFICATION_ID = 6406
        private const val CHANNEL_ID = "multicast_screen_sharing"
    }
}
