package com.sounddrop.audio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.util.Log

/**
 * Android Native Audio Controller managing Oboe C++ low-latency stream lifecycle,
 * system speakerphone routing, and microphone unprocessed recording.
 */
class SoundDropAudioEngine(private val context: Context) {

    companion object {
        private const val TAG = "SoundDropAudioEngine"

        init {
            try {
                System.loadLibrary("sounddrop_oboe")
                Log.i(TAG, "Native sounddrop_oboe library successfully loaded.")
            } catch (e: UnsatisfiedLinkError) {
                Log.e(TAG, "Failed to load native sounddrop_oboe library: ${e.message}")
            }
        }
    }

    private var nativeEnginePtr: Long = 0
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var isCapturing = false

    data class AudioLevel(val peakDbfs: Float, val rmsDbfs: Float, val isClipping: Boolean)

    fun initialize(): Boolean {
        if (nativeEnginePtr == 0L) {
            nativeEnginePtr = nativeCreateEngine()
        }
        return nativeEnginePtr != 0L
    }

    /**
     * Starts low-latency unprocessed microphone capture for acoustic communication.
     * Automatically routes audio to speakerphone and sets communication audio mode.
     */
    fun startCapture(sampleRate: Int = 48000, rawUnprocessed: Boolean = true): Boolean {
        if (nativeEnginePtr == 0L && !initialize()) {
            Log.e(TAG, "Cannot start capture: native engine uninitialized.")
            return false
        }

        // Configure system AudioManager for acoustic transceiver
        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true
        } catch (e: Exception) {
            Log.w(TAG, "Unable to set speakerphone route: ${e.message}")
        }

        val success = nativeStartCapture(nativeEnginePtr, sampleRate, rawUnprocessed)
        isCapturing = success
        return success
    }

    fun stopCapture() {
        if (nativeEnginePtr != 0L && isCapturing) {
            nativeStopCapture(nativeEnginePtr)
            isCapturing = false

            // Restore normal audio routing
            try {
                audioManager.mode = AudioManager.MODE_NORMAL
            } catch (e: Exception) {
                Log.w(TAG, "Unable to restore normal audio mode: ${e.message}")
            }
        }
    }

    /**
     * Reads real-time microphone energy levels (peak & RMS dBFS) for UI waterfall display.
     */
    fun getMeter(): AudioLevel? {
        if (nativeEnginePtr == 0L || !isCapturing) return null

        val buffer = FloatArray(3)
        if (nativeGetMeter(nativeEnginePtr, buffer)) {
            return AudioLevel(
                peakDbfs = buffer[0],
                rmsDbfs = buffer[1],
                isClipping = buffer[2] > 0.5f
            )
        }
        return null
    }

    fun release() {
        stopCapture()
        if (nativeEnginePtr != 0L) {
            nativeDestroyEngine(nativeEnginePtr)
            nativeEnginePtr = 0L
        }
    }

    // Native JNI functions implemented in sounddrop_oboe_engine.cpp
    private external fun nativeCreateEngine(): Long
    private external fun nativeStartCapture(enginePtr: Long, sampleRate: Int, rawUnprocessed: Boolean): Boolean
    private external fun nativeStopCapture(enginePtr: Long)
    private external fun nativeGetMeter(enginePtr: Long, outMeter: FloatArray): Boolean
    private external fun nativeDestroyEngine(enginePtr: Long)
}
