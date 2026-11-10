#pragma once

#include <oboe/Oboe.h>
#include <memory>
#include <atomic>
#include <jni.h>

// SoundDrop Rust C-FFI forward declarations
extern "C" {
    struct SoundDropStreamHandle;
    SoundDropStreamHandle* sounddrop_stream_create(uint32_t sample_rate, uint32_t capacity);
    uint32_t sounddrop_stream_push_samples(SoundDropStreamHandle* handle, const float* samples, size_t count);
    uint32_t sounddrop_stream_pull_samples(SoundDropStreamHandle* handle, float* out_buffer, size_t max_count);
    int32_t sounddrop_stream_get_meter(SoundDropStreamHandle* handle, float* out_peak, float* out_rms, uint8_t* out_clip);
    void sounddrop_stream_destroy(SoundDropStreamHandle* handle);
}

namespace sounddrop {

class SoundDropOboeEngine : public oboe::AudioStreamDataCallback,
                           public oboe::AudioStreamErrorCallback {
public:
    SoundDropOboeEngine();
    virtual ~SoundDropOboeEngine();

    bool startCapture(int32_t sampleRate = 48000, bool rawUnprocessed = true);
    void stopCapture();

    bool startPlayback(int32_t sampleRate = 48000);
    void stopPlayback();

    // oboe::AudioStreamDataCallback
    oboe::DataCallbackResult onAudioReady(
        oboe::AudioStream *audioStream,
        void *audioData,
        int32_t numFrames) override;

    // oboe::AudioStreamErrorCallback
    bool onError(oboe::AudioStream *audioStream, oboe::Result error) override;

    SoundDropStreamHandle* getStreamHandle() const { return mRustStreamHandle; }

private:
    std::shared_ptr<oboe::AudioStream> mCaptureStream;
    std::shared_ptr<oboe::AudioStream> mPlaybackStream;
    SoundDropStreamHandle* mRustStreamHandle;
    std::atomic<bool> mIsCapturing{false};
    std::atomic<bool> mIsPlaying{false};
};

} // namespace sounddrop
