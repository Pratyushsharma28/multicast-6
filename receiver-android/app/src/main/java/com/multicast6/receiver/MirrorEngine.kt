package com.multicast6.receiver

import android.content.Context
import android.content.Intent
import android.app.Activity
import android.graphics.Point
import android.util.DisplayMetrics
import android.view.WindowManager
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.VideoSink
import org.webrtc.ScreenCapturerAndroid
import com.multicast6.receiver.network.SignalingClient
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Owns WebRTC, consent-backed capture, and the shared signaling contract for one session. */
class MirrorEngine(context: Context, private val listener: Listener) {
    interface Listener {
        fun onStatus(message: String, code: String? = null, error: Boolean = false)
        fun onRemoteVideo(track: VideoTrack?)
        fun onSessionEnded()
    }

    private val appContext = context.applicationContext
    private val egl = EglBase.create()
    private val factory: PeerConnectionFactory
    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var client: SignalingClient? = null
    private var peer: PeerConnection? = null
    private var role: String? = null
    private var pairingCode: String? = null
    private var pollTask: java.util.concurrent.ScheduledFuture<*>? = null
    private var videoCapturer: VideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var textureHelper: SurfaceTextureHelper? = null
    private var remoteTrack: VideoTrack? = null
    private val pendingCandidates = mutableListOf<IceCandidate>()
    private val disconnectVersion = AtomicInteger(0)
    private var isStopping = false
    private var suppressSessionEndCallback = false

    val eglContext get() = egl.eglBaseContext

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext).createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
    }

    fun startSending(serverAddress: String, consentResultCode: Int, consentData: Intent) {
        resetSession()
        role = "sender"
        client = SignalingClient(serverAddress)
        listener.onStatus("Creating a secure WebRTC session…")
        executor.execute {
            try {
                val code = client!!.createSession()
                pairingCode = code
                startCapture(consentResultCode, consentData)
                listener.onStatus("Screen sharing is active. Ask the Mac to join with this code.", code)
                startOffer()
                startPolling()
            } catch (error: Exception) {
                fail("Could not start screen sharing: ${error.message ?: "check the Mac address and try again."}")
            }
        }
    }

    fun startReceiving(serverAddress: String, code: String) {
        resetSession()
        role = "receiver"
        pairingCode = code
        client = SignalingClient(serverAddress)
        listener.onStatus("Joining the Mac's session…", code)
        executor.execute {
            try {
                client!!.join(code)
                setupPeer("receiver")
                listener.onStatus("Connected to pairing. Waiting for the Mac's video…", code)
                startPolling()
            } catch (error: Exception) {
                fail("Could not join: ${error.message ?: "check the code and Mac address."}")
            }
        }
    }

    fun setRemoteSink(sink: VideoSink?) {
        remoteTrack?.let { track -> runCatching { track.removeSink(currentSink) } }
        currentSink = sink
        remoteTrack?.let { track -> sink?.let(track::addSink) }
    }

    private var currentSink: VideoSink? = null

    fun resizeCapture() {
        val (width, height) = displaySize()
        runCatching { videoCapturer?.changeCaptureFormat(width, height, 15) }
    }

    private fun setupPeer(localRole: String) {
        val configuration = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        peer = factory.createPeerConnection(configuration, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> {
                        disconnectVersion.incrementAndGet()
                        listener.onStatus("Connected directly over the local network.", pairingCode)
                    }
                    PeerConnection.IceConnectionState.FAILED -> fail("Connection failed. Check both devices are on the same Wi-Fi and client isolation is off.")
                    PeerConnection.IceConnectionState.DISCONNECTED -> {
                        listener.onStatus("Connection interrupted. Trying to recover…", pairingCode, true)
                        val version = disconnectVersion.incrementAndGet()
                        executor.schedule({
                            if (disconnectVersion.get() == version && peer != null) {
                                fail("The peer stayed disconnected. Check both devices' Wi-Fi and start a new session.")
                            }
                        }, 8, TimeUnit.SECONDS)
                    }
                    else -> Unit
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
            override fun onIceCandidate(candidate: IceCandidate) {
                val message = JSONObject().apply {
                    put("type", "candidate")
                    put("candidate", JSONObject().apply {
                        put("candidate", candidate.sdp)
                        put("sdpMid", candidate.sdpMid ?: JSONObject.NULL)
                        put("sdpMLineIndex", candidate.sdpMLineIndex)
                    })
                }
                sendSignal(message)
            }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
            override fun onAddStream(stream: MediaStream?) = Unit
            override fun onRemoveStream(stream: MediaStream?) = Unit
            override fun onDataChannel(channel: DataChannel?) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                (receiver?.track() as? VideoTrack)?.let(::attachRemoteTrack)
            }
            override fun onTrack(transceiver: RtpTransceiver?) {
                (transceiver?.receiver?.track() as? VideoTrack)?.let(::attachRemoteTrack)
            }
        }) ?: error("WebRTC could not create a peer connection.")
        if (localRole == "sender") {
            val source = factory.createVideoSource(false)
            val capturer = ScreenCapturerAndroid(requireNotNull(captureIntent), object : android.media.projection.MediaProjection.Callback() {
                override fun onStop() {
                    listener.onStatus("Android stopped screen sharing.", pairingCode)
                    stopSession(deleteRemoteSession = true)
                }
            })
            val helper = SurfaceTextureHelper.create("MultiCastScreenCapture", egl.eglBaseContext)
                ?: error("Could not prepare the screen capture surface.")
            capturer.initialize(helper, appContext, source.capturerObserver)
            val (width, height) = displaySize()
            capturer.startCapture(width, height, 15)
            val track = factory.createVideoTrack("multicast-screen", source)
            peer?.addTrack(track, listOf("multicast-screen-stream"))
            videoSource = source
            videoCapturer = capturer
            videoTrack = track
            textureHelper = helper
        }
    }

    private var captureIntent: Intent? = null

    private fun startCapture(resultCode: Int, data: Intent) {
        require(resultCode == Activity.RESULT_OK) { "Android screen-sharing consent was not granted." }
        captureIntent = data
        // setupPeer needs the one-use consent token; it is read only after explicit system consent.
        setupPeer("sender")
    }

    private fun displaySize(): Pair<Int, Int> {
        val manager = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        manager.defaultDisplay.getRealMetrics(metrics)
        return metrics.widthPixels.coerceAtLeast(2) to metrics.heightPixels.coerceAtLeast(2)
    }

    private fun startOffer() {
        val connection = peer ?: error("WebRTC connection is not ready.")
        connection.createOffer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription?) {
                if (description == null) return fail("WebRTC did not create an offer.")
                connection.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        sendSignal(JSONObject().put("type", "offer").put("description", descriptionJson(description)))
                    }
                    override fun onSetFailure(error: String?) = fail("Could not set the sender description: $error")
                    override fun onCreateSuccess(description: SessionDescription?) = Unit
                    override fun onCreateFailure(error: String?) = Unit
                }, description)
            }
            override fun onCreateFailure(error: String?) = fail("Could not create WebRTC offer: $error")
            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String?) = Unit
        }, MediaConstraints())
    }

    private fun startPolling() {
        pollTask?.cancel(true)
        pollTask = executor.scheduleWithFixedDelay({
            val currentClient = client ?: return@scheduleWithFixedDelay
            val code = pairingCode ?: return@scheduleWithFixedDelay
            val currentRole = role ?: return@scheduleWithFixedDelay
            try {
                currentClient.poll(code, currentRole).forEach(::handleSignal)
            } catch (error: Exception) {
                listener.onStatus("Signaling connection lost: ${error.message ?: "check the Mac and local network."}", code, true)
            }
        }, 0, 350, TimeUnit.MILLISECONDS)
    }

    private fun handleSignal(message: JSONObject) {
        if (message.optInt("protocolVersion", -1) != SignalingClient.PROTOCOL_VERSION) return fail("The other device uses an unsupported signaling version.")
        when (message.optString("type")) {
            "offer" -> if (role == "receiver") {
                val raw = message.optJSONObject("description") ?: return fail("The Mac sent an invalid WebRTC offer.")
                val description = SessionDescription(SessionDescription.Type.fromCanonicalForm(raw.optString("type")), raw.optString("sdp"))
                peer?.setRemoteDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        flushCandidates()
                        createAnswer()
                    }
                    override fun onSetFailure(error: String?) = fail("Could not accept the Mac's video offer: $error")
                    override fun onCreateSuccess(description: SessionDescription?) = Unit
                    override fun onCreateFailure(error: String?) = Unit
                }, description)
            }
            "answer" -> if (role == "sender") {
                val raw = message.optJSONObject("description") ?: return fail("The Android receiver sent an invalid answer.")
                val description = SessionDescription(SessionDescription.Type.fromCanonicalForm(raw.optString("type")), raw.optString("sdp"))
                peer?.setRemoteDescription(object : SdpObserver {
                    override fun onSetSuccess() = flushCandidates()
                    override fun onSetFailure(error: String?) = fail("Could not accept the receiver's answer: $error")
                    override fun onCreateSuccess(description: SessionDescription?) = Unit
                    override fun onCreateFailure(error: String?) = Unit
                }, description)
            }
            "candidate" -> message.optJSONObject("candidate")?.let { raw ->
                val candidate = IceCandidate(raw.optString("sdpMid").takeUnless { it == "null" }, raw.optInt("sdpMLineIndex"), raw.optString("candidate"))
                if (peer?.remoteDescription == null) pendingCandidates += candidate else peer?.addIceCandidate(candidate)
            }
            "stop" -> {
                listener.onStatus("The other device stopped the session.", pairingCode)
                stopSession(deleteRemoteSession = false)
            }
        }
    }

    private fun createAnswer() {
        val connection = peer ?: return
        connection.createAnswer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription?) {
                if (description == null) return fail("WebRTC did not create an answer.")
                connection.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        sendSignal(JSONObject().put("type", "answer").put("description", descriptionJson(description)))
                    }
                    override fun onSetFailure(error: String?) = fail("Could not set the receiver description: $error")
                    override fun onCreateSuccess(description: SessionDescription?) = Unit
                    override fun onCreateFailure(error: String?) = Unit
                }, description)
            }
            override fun onCreateFailure(error: String?) = fail("Could not create WebRTC answer: $error")
            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String?) = Unit
        }, MediaConstraints())
    }

    private fun flushCandidates() {
        pendingCandidates.toList().forEach { peer?.addIceCandidate(it) }
        pendingCandidates.clear()
    }

    private fun sendSignal(message: JSONObject) {
        executor.execute {
            try {
                val code = pairingCode ?: return@execute
                client?.send(code, role ?: return@execute, message)
            } catch (error: Exception) {
                listener.onStatus("Could not send connection setup: ${error.message ?: "check the local network."}", pairingCode, true)
            }
        }
    }

    private fun descriptionJson(description: SessionDescription) = JSONObject()
        .put("type", description.type.canonicalForm())
        .put("sdp", description.description)

    private fun attachRemoteTrack(track: VideoTrack) {
        remoteTrack?.let { old -> currentSink?.let(old::removeSink) }
        remoteTrack = track
        currentSink?.let(track::addSink)
        listener.onRemoteVideo(track)
        listener.onStatus("Receiving the Mac's screen. Keep this app open to view it.", pairingCode)
    }

    fun stopSession(deleteRemoteSession: Boolean) {
        if (isStopping) return
        val hadSession = peer != null || client != null || pairingCode != null || videoCapturer != null
        isStopping = true
        val code = pairingCode
        disconnectVersion.incrementAndGet()
        pollTask?.cancel(true)
        pollTask = null
        if (deleteRemoteSession && code != null) {
            val oldClient = client
            val oldRole = role
            runCatching { oldClient?.send(code, oldRole ?: return@runCatching, JSONObject().put("type", "stop")) }
            if (oldClient != null) Thread {
                Thread.sleep(800)
                runCatching { oldClient.stop(code) }
            }.start()
        }
        peer?.close()
        peer = null
        videoTrack?.dispose()
        videoTrack = null
        runCatching { videoCapturer?.stopCapture() }
        videoCapturer?.dispose()
        videoCapturer = null
        videoSource?.dispose()
        videoSource = null
        textureHelper?.dispose()
        textureHelper = null
        remoteTrack = null
        currentSink = null
        pendingCandidates.clear()
        pairingCode = null
        role = null
        client = null
        captureIntent = null
        if (hadSession) {
            listener.onRemoteVideo(null)
            if (!suppressSessionEndCallback) listener.onSessionEnded()
        }
        isStopping = false
    }

    private fun resetSession() {
        suppressSessionEndCallback = true
        try {
            stopSession(deleteRemoteSession = true)
        } finally {
            suppressSessionEndCallback = false
            isStopping = false
        }
    }

    private fun fail(message: String) {
        listener.onStatus(message, pairingCode, true)
        stopSession(deleteRemoteSession = true)
    }

    fun dispose() {
        stopSession(deleteRemoteSession = true)
        executor.shutdownNow()
        factory.dispose()
        egl.release()
    }
}
