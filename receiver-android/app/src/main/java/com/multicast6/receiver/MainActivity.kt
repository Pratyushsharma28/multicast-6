package com.multicast6.receiver

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import com.multicast6.receiver.network.SignalingClient
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

class MainActivity : ComponentActivity(), MirrorService.UiListener {
    private lateinit var serverField: EditText
    private lateinit var codeField: EditText
    private lateinit var statusView: TextView
    private lateinit var codeView: TextView
    private lateinit var permissionView: TextView
    private lateinit var preview: SurfaceViewRenderer
    private var mirrorService: MirrorService? = null
    private var bound = false
    private var rendererReady = false
    private var latestCode: String? = null
    private var serviceStatus = "Ready. Choose whether to send or receive a screen."
    private var pendingCaptureServer: String? = null

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted && Build.VERSION.SDK_INT >= 33) {
            showStatus("Notifications are off. Android may show the sharing notice in its Active apps screen; use Stop sharing here or the system sharing indicator.", false)
        }
        launchCaptureConsent()
    }

    private val captureConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            permissionView.text = "Screen capture permission: Granted for this session"
            startSendService(result.resultCode, data)
        } else {
            permissionView.text = "Screen capture permission: Not granted"
            showStatus("Android did not grant screen sharing. Tap Send Screen to Mac and approve the system prompt.", true)
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val service = (binder as? MirrorService.LocalBinder)?.service ?: return
            mirrorService = service
            bound = true
            if (!rendererReady) {
                preview.init(service.eglContext, null)
                rendererReady = true
            }
            service.addUiListener(this@MainActivity)
            service.setRemoteSink(preview)
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            mirrorService?.removeUiListener(this@MainActivity)
            mirrorService = null
            bound = false
            showStatus("Mirroring service disconnected. Stop and reconnect.", true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("multicast", MODE_PRIVATE)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(8, 10, 15)) }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(28), dp(24), dp(36))
        }
        root.addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(root) }

        content.addView(text("M6", 12, Color.WHITE, bold = true, background = Color.rgb(81, 65, 180), pad = 12))
        content.addView(text("MultiCast 6", 28, Color.WHITE, bold = true, top = 14))
        content.addView(text("SCREEN MIRRORING", 11, Color.rgb(157, 132, 255), bold = true, top = 4))
        content.addView(text("Send your Android screen to a Mac, or receive a Mac screen here. Video travels directly over WebRTC on your local network.", 14, Color.rgb(157, 165, 182), top = 16))

        content.addView(text("MAC SIGNALING ADDRESS", 11, Color.rgb(109, 231, 239), bold = true, top = 24))
        serverField = EditText(this).apply {
            hint = "Mac address, e.g. 192.168.1.25:3000"
            setHintTextColor(Color.rgb(106, 116, 134))
            setTextColor(Color.WHITE)
            textSize = 14f
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setBackgroundColor(Color.rgb(21, 25, 34))
            setText(prefs.getString("server", ""))
        }
        content.addView(serverField, matchWidth(top = 8))
        content.addView(text("Enter the Mac's LAN IP and backend port 3000. Both devices must be on the same Wi-Fi.", 11, Color.rgb(126, 135, 152), top = 7))

        permissionView = text("Screen capture permission: Not requested", 12, Color.rgb(181, 196, 204), top = 18)
        content.addView(permissionView)
        content.addView(text("SEND SCREEN TO MAC", 11, Color.rgb(109, 231, 239), bold = true, top = 26))
        content.addView(text("Android will show its own screen-sharing consent prompt before capture starts.", 12, Color.rgb(157, 165, 182), top = 6))
        content.addView(actionButton("Send Screen to Mac") { requestCaptureConsent() }, matchWidth(top = 10))

        content.addView(text("RECEIVE SCREEN FROM MAC", 11, Color.rgb(109, 231, 239), bold = true, top = 28))
        content.addView(text("Enter the six-digit code displayed in Mac Cast Studio.", 12, Color.rgb(157, 165, 182), top = 6))
        codeField = EditText(this).apply {
            hint = "6-digit pairing code"
            setHintTextColor(Color.rgb(106, 116, 134))
            setTextColor(Color.WHITE)
            textSize = 16f
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(android.text.InputFilter.LengthFilter(6))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setBackgroundColor(Color.rgb(21, 25, 34))
        }
        content.addView(codeField, matchWidth(top = 10))
        content.addView(actionButton("Receive Screen from Mac") { startReceive() }, matchWidth(top = 10))

        content.addView(text("LIVE PREVIEW", 11, Color.rgb(109, 231, 239), bold = true, top = 26))
        preview = SurfaceViewRenderer(this).apply {
            setBackgroundColor(Color.rgb(12, 14, 20))
            setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        }
        content.addView(preview, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(220)).apply { topMargin = dp(8) })
        statusView = text(serviceStatus, 13, Color.rgb(211, 204, 255), top = 16)
        content.addView(statusView)
        codeView = text("Pairing code: —", 20, Color.WHITE, bold = true, top = 10)
        content.addView(codeView)

        content.addView(actionButton("Stop sharing / disconnect") {
            hideKeyboard()
            mirrorService?.stopSession(deleteRemoteSession = true)
            permissionView.text = "Screen capture permission: Not requested"
            showStatus("Session stopped.", false)
        }.apply { setTextColor(Color.rgb(255, 177, 177)); setBackgroundColor(Color.rgb(53, 29, 37)) }, matchWidth(top = 18))
        content.addView(text("If the connection fails, confirm that the Mac backend is running and that ports 3000 and 5173 are reachable. The backend relays setup messages only; it does not carry video.", 11, Color.rgb(126, 135, 152), top = 18))
        setContentView(scroll)
    }

    override fun onStart() {
        super.onStart()
        bound = bindService(Intent(this, MirrorService::class.java), connection, Context.BIND_AUTO_CREATE)
    }

    override fun onStop() {
        mirrorService?.setRemoteSink(null)
        if (bound) {
            mirrorService?.removeUiListener(this)
            unbindService(connection)
            bound = false
            mirrorService = null
        }
        super.onStop()
    }

    private fun requestCaptureConsent() {
        val server = normalizedServer() ?: return
        getSharedPreferences("multicast", MODE_PRIVATE).edit().putString("server", server).apply()
        pendingCaptureServer = server
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        launchCaptureConsent()
    }

    private fun launchCaptureConsent() {
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
        permissionView.text = "Screen capture permission: Waiting for Android…"
        captureConsent.launch(manager.createScreenCaptureIntent())
    }

    private fun startSendService(resultCode: Int, data: Intent) {
        val server = pendingCaptureServer ?: normalizedServer() ?: return
        val intent = Intent(this, MirrorService::class.java)
            .setAction(MirrorService.ACTION_SEND)
            .putExtra(MirrorService.EXTRA_SERVER, server)
            .putExtra(MirrorService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(MirrorService.EXTRA_RESULT_DATA, data)
        ContextCompat.startForegroundService(this, intent)
        showStatus("Starting screen capture and WebRTC…", false)
    }

    private fun startReceive() {
        val server = normalizedServer() ?: return
        val code = codeField.text.toString().trim()
        try {
            SignalingClient.requirePairingCode(code)
        } catch (error: IllegalArgumentException) {
            showStatus(error.message ?: "Enter the six-digit pairing code.", true)
            return
        }
        getSharedPreferences("multicast", MODE_PRIVATE).edit().putString("server", server).apply()
        val intent = Intent(this, MirrorService::class.java)
            .setAction(MirrorService.ACTION_RECEIVE)
            .putExtra(MirrorService.EXTRA_SERVER, server)
            .putExtra(MirrorService.EXTRA_CODE, code)
        startService(intent)
        showStatus("Joining Mac session…", false)
        hideKeyboard()
    }

    private fun normalizedServer(): String? = try {
        SignalingClient.normalizeServerAddress(serverField.text.toString()).also { serverField.setText(it) }
    } catch (error: IllegalArgumentException) {
        showStatus(error.message ?: "Enter a valid Mac signaling address.", true)
        null
    }

    private fun showStatus(message: String, error: Boolean) {
        serviceStatus = message
        if (::statusView.isInitialized) {
            statusView.text = message
            statusView.setTextColor(if (error) Color.rgb(230, 166, 93) else Color.rgb(211, 204, 255))
        }
    }

    override fun onStatus(message: String, code: String?, error: Boolean) {
        latestCode = code
        showStatus(message, error)
        if (::codeView.isInitialized) codeView.text = code?.let { "PAIRING CODE  $it" } ?: "Pairing code: —"
    }

    override fun onRemoteVideo(track: VideoTrack?) = Unit

    override fun onSessionEnded() {
        latestCode = null
        if (::codeView.isInitialized) codeView.text = "Pairing code: —"
        if (::permissionView.isInitialized) permissionView.text = "Screen capture permission: Not requested"
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        mirrorService?.resizeCapture()
    }

    override fun onDestroy() {
        if (::preview.isInitialized && rendererReady) preview.release()
        rendererReady = false
        super.onDestroy()
    }

    private fun hideKeyboard() {
        (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(codeField.windowToken, 0)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun matchWidth(top: Int = 0) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

    private fun text(value: String, size: Int, color: Int, bold: Boolean = false, top: Int = 8, background: Int? = null, pad: Int = 0) = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        setTextColor(color)
        gravity = Gravity.CENTER
        if (bold) setTypeface(typeface, Typeface.BOLD)
        if (background != null) setBackgroundColor(background)
        setPadding(dp(pad), dp(if (pad > 0) pad else 0), dp(pad), dp(if (pad > 0) pad else 0))
        layoutParams = matchWidth(top)
    }

    private fun actionButton(value: String, action: () -> Unit) = Button(this).apply {
        text = value
        isAllCaps = false
        textSize = 15f
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.rgb(78, 64, 170))
        setOnClickListener { action() }
    }
}
