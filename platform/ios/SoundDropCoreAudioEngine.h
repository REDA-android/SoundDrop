#import <Foundation/Foundation.h>
#import <AudioToolbox/AudioToolbox.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Objective-C CoreAudio RemoteIO engine for low-latency acoustic transceiver on iOS.
 */
@interface SoundDropCoreAudioEngine : NSObject

@property (nonatomic, readonly) BOOL isRunning;

+ (instancetype)sharedEngine;

- (BOOL)startAudioUnitWithSampleRate:(Float64)sampleRate error:(NSError **)error;
- (void)stopAudioUnit;

- (void)getMeterWithPeak:(float *)outPeak rms:(float *)outRms isClipping:(BOOL *)outClip;

@end

NS_ASSUME_NONNULL_END
