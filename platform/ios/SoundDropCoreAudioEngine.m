#import "SoundDropCoreAudioEngine.h"

// Rust C-FFI forward declarations
extern void* sounddrop_stream_create(uint32_t sample_rate, uint32_t capacity);
extern uint32_t sounddrop_stream_push_samples(void* handle, const float* samples, size_t count);
extern uint32_t sounddrop_stream_pull_samples(void* handle, float* out_buffer, size_t max_count);
extern int32_t sounddrop_stream_get_meter(void* handle, float* out_peak, float* out_rms, uint8_t* out_clip);
extern void sounddrop_stream_destroy(void* handle);

@interface SoundDropCoreAudioEngine () {
    AudioUnit _remoteIOUnit;
    void* _rustStreamHandle;
    BOOL _isRunning;
}
@end

static OSStatus SoundDropInputRenderCallback(
    void *inRefCon,
    AudioUnitRenderActionFlags *ioActionFlags,
    const AudioTimeStamp *inTimeStamp,
    UInt32 inBusNumber,
    UInt32 inNumberFrames,
    AudioBufferList *ioData) {

    SoundDropCoreAudioEngine *engine = (__bridge SoundDropCoreAudioEngine *)inRefCon;

    AudioBuffer buffer;
    buffer.mNumberChannels = 1;
    buffer.mDataByteSize = inNumberFrames * sizeof(Float32);

    Float32 tempSamples[inNumberFrames];
    buffer.mData = tempSamples;

    AudioBufferList bufferList;
    bufferList.mNumberBuffers = 1;
    bufferList.mBuffers[0] = buffer;

    OSStatus status = AudioUnitRender(
        engine->_remoteIOUnit,
        ioActionFlags,
        inTimeStamp,
        1, // Input bus
        inNumberFrames,
        &bufferList
    );

    if (status == noErr && engine->_rustStreamHandle != NULL) {
        sounddrop_stream_push_samples(engine->_rustStreamHandle, tempSamples, inNumberFrames);
    }

    return status;
}

@implementation SoundDropCoreAudioEngine

@synthesize isRunning = _isRunning;

+ (instancetype)sharedEngine {
    static SoundDropCoreAudioEngine *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[SoundDropCoreAudioEngine alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _rustStreamHandle = sounddrop_stream_create(48000, 48000);
        _isRunning = NO;
    }
    return self;
}

- (void)dealloc {
    [self stopAudioUnit];
    if (_rustStreamHandle != NULL) {
        sounddrop_stream_destroy(_rustStreamHandle);
        _rustStreamHandle = NULL;
    }
}

- (BOOL)startAudioUnitWithSampleRate:(Float64)sampleRate error:(NSError **)error {
    if (_isRunning) return YES;

    AudioComponentDescription desc;
    desc.componentType = kAudioUnitType_Output;
    desc.componentSubType = kAudioUnitSubType_RemoteIO;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    desc.componentFlags = 0;
    desc.componentFlagsMask = 0;

    AudioComponent comp = AudioComponentFindNext(NULL, &desc);
    if (!comp) {
        if (error) {
            *error = [NSError errorWithDomain:@"SoundDropCoreAudio" code:-1 userInfo:@{NSLocalizedDescriptionKey: @"RemoteIO component not found"}];
        }
        return NO;
    }

    OSStatus status = AudioComponentInstanceNew(comp, &_remoteIOUnit);
    if (status != noErr) return NO;

    // Enable Input Bus (1 = Mic)
    UInt32 enableInput = 1;
    AudioUnitSetProperty(_remoteIOUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &enableInput, sizeof(enableInput));

    // Disable Output Bus (0 = Speaker) if only capturing, or enable for playback
    UInt32 enableOutput = 0;
    AudioUnitSetProperty(_remoteIOUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &enableOutput, sizeof(enableOutput));

    // Format: 32-bit Float Linear PCM, 1 Channel Mono, Native Endian
    AudioStreamBasicDescription asbd = {0};
    asbd.mSampleRate = sampleRate;
    asbd.mFormatID = kAudioFormatLinearPCM;
    asbd.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    asbd.mBytesPerPacket = sizeof(Float32);
    asbd.mFramesPerPacket = 1;
    asbd.mBytesPerFrame = sizeof(Float32);
    asbd.mChannelsPerFrame = 1;
    asbd.mBitsPerChannel = 32;

    AudioUnitSetProperty(_remoteIOUnit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &asbd, sizeof(asbd));

    // Set Input Render Callback
    AURenderCallbackStruct callbackStruct;
    callbackStruct.inputProc = SoundDropInputRenderCallback;
    callbackStruct.inputProcRefCon = (__bridge void *)self;
    AudioUnitSetProperty(_remoteIOUnit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0, &callbackStruct, sizeof(callbackStruct));

    AudioUnitInitialize(_remoteIOUnit);
    status = AudioOutputUnitStart(_remoteIOUnit);
    if (status == noErr) {
        _isRunning = YES;
        return YES;
    }

    return NO;
}

- (void)stopAudioUnit {
    if (_isRunning && _remoteIOUnit) {
        AudioOutputUnitStop(_remoteIOUnit);
        AudioUnitUninitialize(_remoteIOUnit);
        AudioComponentInstanceDispose(_remoteIOUnit);
        _remoteIOUnit = NULL;
        _isRunning = NO;
    }
}

- (void)getMeterWithPeak:(float *)outPeak rms:(float *)outRms isClipping:(BOOL *)outClip {
    if (_rustStreamHandle != NULL) {
        uint8_t clip = 0;
        sounddrop_stream_get_meter(_rustStreamHandle, outPeak, outRms, &clip);
        if (outClip) *outClip = (clip != 0);
    }
}

@end
