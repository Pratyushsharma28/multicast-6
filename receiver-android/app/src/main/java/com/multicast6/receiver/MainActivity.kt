package com.multicast6.receiver

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import java.util.UUID

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val identity = getSharedPreferences("receiver", MODE_PRIVATE).let { preferences ->
            preferences.getString("identity", null) ?: UUID.randomUUID().toString().also {
                preferences.edit().putString("identity", it).apply()
            }
        }

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(72, 48, 72, 48)
            setBackgroundColor(Color.rgb(16, 24, 32))
        }
        page.addView(label("MultiCast Receiver", 34, Color.WHITE, true))
        page.addView(label("Android TV receiver scaffold", 18, Color.rgb(181, 196, 204)))
        page.addView(label("PAIRING", 14, Color.rgb(112, 214, 193), true, 36))
        page.addView(label("Not paired", 24, Color.WHITE))
        page.addView(label("Pairing is not implemented yet.", 16, Color.rgb(181, 196, 204)))
        page.addView(label("RECEIVER IDENTITY", 14, Color.rgb(112, 214, 193), true, 36))
        page.addView(label(identity, 18, Color.WHITE))
        page.addView(label("No remote-control or playback commands are enabled.", 16, Color.rgb(181, 196, 204), top = 24))
        setContentView(page, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun label(text: String, size: Int, color: Int, bold: Boolean = false, top: Int = 12): TextView =
        TextView(this).apply {
            this.text = text
            textSize = size.toFloat()
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, top, 0, 0)
            isFocusable = false
        }
}
