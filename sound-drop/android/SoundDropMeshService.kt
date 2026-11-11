package com.sounddrop.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * SoundDrop Android Foreground Service.
 * Keeps the microphone and acoustic mesh listener alive in the pocket while phone is locked,
 * strictly compliant with Android 10+ battery optimizations.
 */
class SoundDropMeshService : Service() {

    companion object {
        private const val CHANNEL_ID = "sounddrop_mesh_channel"
        private const val NOTIFICATION_ID = 4040

        init {
            // Load native Rust dynamic library (libsounddrop_bridge.so)
            System.loadLibrary("sounddrop_bridge")
        }

        fun startMeshService(context: Context) {
            val intent = Intent(context, SoundDropMeshService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopMeshService(context: Context) {
            val intent = Intent(context, SoundDropMeshService::class.java)
            context.stopService(intent)
        }
    }

    private var isListening = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildForegroundNotification()
        startForeground(NOTIFICATION_ID, notification)

        startAcousticMeshListening()

        // Keep service running even if system kills it under memory pressure
        return START_STICKY
    }

    private fun startAcousticMeshListening() {
        if (isListening) return
        isListening = true

        // Call native Rust library via JNI
        val version = SoundDropNative.version()
        val identity = SoundDropNative.generateIdentity()
        val hash = SoundDropNative.computeRecipientHash(identity)

        println("[SoundDrop Kotlin] Mesh Service active: $version")
        println("[SoundDrop Kotlin] Node Hash: ${hash.joinToString("") { "%02x".format(it) }}")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SoundDrop Mesh Sentinel",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Écoute acoustique passive pour le relais maillé villageois"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SoundDrop Air-Gap Mesh")
            .setContentText("Relais acoustique actif en arrière-plan (Mode Éco)")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isListening = false
        super.onDestroy()
    }
}

/**
 * JNI Native Interface to the compiled Rust library
 */
object SoundDropNative {
    external fun version(): String
    external fun generateIdentity(): ByteArray
    external fun computeRecipientHash(publicKey: ByteArray): ByteArray
}
