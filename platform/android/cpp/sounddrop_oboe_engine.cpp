#include "sounddrop_oboe_engine.h"
#include <android/log.h>

#define TAG "SoundDropOboe"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace sounddrop {

SoundDropOboeEngine::SoundDropOboeEngine() : mRustStreamHandle(nullptr) {
    // 48 kHz default ringbuffer capacity (1 second)
    mRustStreamHandle = sounddrop_stream_create(48000, 48000);
}

SoundDropOboeEngine::~SoundDropOboeEngine() {
    stopCapture();
    stopPlayback();
    if (mRustStreamHandle != nullptr) {
        sounddrop_stream_destroy(mRustStreamHandle);
        mRustStreamHandle = nullptr;
    }
}

bool SoundDropOboeEngine::startCapture(int32_t sampleRate, bool rawUnprocessed) {
    if (mIsCapturing.load()) {
        return true;
    }

    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Input);
    builder.setPerformanceMode(oboe::PerformanceMode::LowLatency);
    builder.setSharingMode(oboe::SharingMode::Exclusive);
    builder.setFormat(oboe::AudioFormat::Float);
    builder.setChannelCount(oboe::ChannelCount::Mono);
    builder.setSampleRate(sampleRate);
    builder.setDataCallback(this);
    builder.setErrorCallback(this);

    // CRITICAL ACOUSTIC CONFIGURATION:
    // Bypass aggressive hardware Automatic Gain Control (AGC), Acoustic Echo Cancellation (AEC),
    // and Noise Suppression filters that mangle ultrasonic and FSK acoustic modulated tones.
    if (rawUnprocessed) {
        builder.setInputPreset(oboe::InputPreset::VoiceRecognition); // or Unprocessed where API >= 24
    } else {
        builder.setInputPreset(oboe::InputPreset::Generic);
    }

    oboe::Result result = builder.openStream(mCaptureStream);
    if (result != oboe::Result::OK) {
        LOGE("Failed to open Oboe capture stream. Error: %s", oboe::convertToText(result));
        return false;
    }

    result = mCaptureStream->requestStart();
    if (result != oboe::Result::OK) {
        LOGE("Failed to start Oboe capture stream. Error: %s", oboe::convertToText(result));
        mCaptureStream->close();
        mCaptureStream.reset();
        return false;
    }

    mIsCapturing.store(true);
    LOGI("Oboe capture stream successfully started at %d Hz (Mono, Float)", sampleRate);
    return true;
}

void SoundDropOboeEngine::stopCapture() {
    if (mIsCapturing.load() && mCaptureStream) {
        mCaptureStream->stop();
        mCaptureStream->close();
        mCaptureStream.reset();
        mIsCapturing.store(false);
        LOGI("Oboe capture stream stopped.");
    }
}

bool SoundDropOboeEngine::startPlayback(int32_t sampleRate) {
    if (mIsPlaying.load()) {
        return true;
    }

    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Output);
    builder.setPerformanceMode(oboe::PerformanceMode::LowLatency);
    builder.setSharingMode(oboe::SharingMode::Exclusive);
    builder.setFormat(oboe::AudioFormat::Float);
    builder.setChannelCount(oboe::ChannelCount::Mono);
    builder.setSampleRate(sampleRate);
    builder.setUsage(oboe::Usage::Media);
    builder.setDataCallback(this);
    builder.setErrorCallback(this);

    oboe::Result result = builder.openStream(mPlaybackStream);
    if (result != oboe::Result::OK) {
        LOGE("Failed to open Oboe playback stream. Error: %s", oboe::convertToText(result));
        return false;
    }

    result = mPlaybackStream->requestStart();
    if (result != oboe::Result::OK) {
        LOGE("Failed to start Oboe playback stream. Error: %s", oboe::convertToText(result));
        mPlaybackStream->close();
        mPlaybackStream.reset();
        return false;
    }

    mIsPlaying.store(true);
    LOGI("Oboe playback stream successfully started at %d Hz (Mono, Float)", sampleRate);
    return true;
}

void SoundDropOboeEngine::stopPlayback() {
    if (mIsPlaying.load() && mPlaybackStream) {
        mPlaybackStream->stop();
        mPlaybackStream->close();
        mPlaybackStream.reset();
        mIsPlaying.store(false);
        LOGI("Oboe playback stream stopped.");
    }
}

oboe::DataCallbackResult SoundDropOboeEngine::onAudioReady(
    oboe::AudioStream *audioStream,
    void *audioData,
    int32_t numFrames) {

    if (audioStream->getDirection() == oboe::Direction::Input) {
        // Feed captured PCM float samples directly into Rust core ringbuffer
        const float* inputSamples = static_cast<const float*>(audioData);
        if (mRustStreamHandle != nullptr && inputSamples != nullptr && numFrames > 0) {
            sounddrop_stream_push_samples(mRustStreamHandle, inputSamples, static_cast<size_t>(numFrames));
        }
    } else if (audioStream->getDirection() == oboe::Direction::Output) {
        // Pull PCM float samples from Rust core ringbuffer to speaker
        float* outputSamples = static_cast<float*>(audioData);
        if (mRustStreamHandle != nullptr && outputSamples != nullptr && numFrames > 0) {
            uint32_t pulled = sounddrop_stream_pull_samples(mRustStreamHandle, outputSamples, static_cast<size_t>(numFrames));
            // Fill remaining with silence if underrun
            for (int32_t i = pulled; i < numFrames; ++i) {
                outputSamples[i] = 0.0f;
            }
        }
    }

    return oboe::DataCallbackResult::Continue;
}

bool SoundDropOboeEngine::onError(oboe::AudioStream *audioStream, oboe::Result error) {
    LOGE("Oboe stream error callback triggered: %s", oboe::convertToText(error));
    return false; // Let Oboe handle stream teardown
}

} // namespace sounddrop

// ----------------------------------------------------------------------------
// JNI Exports for Android Kotlin/Java Layer
// ----------------------------------------------------------------------------
extern "C" {

JNIEXPORT jlong JNICALL
Java_com_sounddrop_audio_SoundDropAudioEngine_nativeCreateEngine(JNIEnv *env, jobject thiz) {
    auto* engine = new sounddrop::SoundDropOboeEngine();
    return reinterpret_cast<jlong>(engine);
}

JNIEXPORT jboolean JNICALL
Java_com_sounddrop_audio_SoundDropAudioEngine_nativeStartCapture(
    JNIEnv *env, jobject thiz, jlong enginePtr, jint sampleRate, jboolean rawUnprocessed) {
    auto* engine = reinterpret_cast<sounddrop::SoundDropOboeEngine*>(enginePtr);
    if (!engine) return JNI_FALSE;
    return engine->startCapture(sampleRate, rawUnprocessed) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_sounddrop_audio_SoundDropAudioEngine_nativeStopCapture(
    JNIEnv *env, jobject thiz, jlong enginePtr) {
    auto* engine = reinterpret_cast<sounddrop::SoundDropOboeEngine*>(enginePtr);
    if (engine) engine->stopCapture();
}

JNIEXPORT jboolean JNICALL
Java_com_sounddrop_audio_SoundDropAudioEngine_nativeGetMeter(
    JNIEnv *env, jobject thiz, jlong enginePtr, jfloatArray outMeter) {
    auto* engine = reinterpret_cast<sounddrop::SoundDropOboeEngine*>(enginePtr);
    if (!engine || !engine->getStreamHandle()) return JNI_FALSE;

    float peak = -96.0f;
    float rms = -96.0f;
    uint8_t clip = 0;
    int32_t res = sounddrop_stream_get_meter(engine->getStreamHandle(), &peak, &rms, &clip);
    if (res != 0) return JNI_FALSE;

    jfloat buffer[3] = { peak, rms, static_cast<jfloat>(clip) };
    env->SetFloatArrayRegion(outMeter, 0, 3, buffer);
    return JNI_TRUE;
}

JNIEXPORT void JNICALL
Java_com_sounddrop_audio_SoundDropAudioEngine_nativeDestroyEngine(
    JNIEnv *env, jobject thiz, jlong enginePtr) {
    auto* engine = reinterpret_cast<sounddrop::SoundDropOboeEngine*>(enginePtr);
    delete engine;
}

} // extern "C"
