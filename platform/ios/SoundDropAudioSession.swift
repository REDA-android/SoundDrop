import AVFoundation
import Foundation

/**
 * iOS Native Audio Session Manager configured specifically for acoustic communication.
 * Enforces AVAudioSessionModeMeasurement to completely bypass Apple's automatic gain control,
 * speech high-pass filtering, and dynamic noise suppression.
 */
@objc public final class SoundDropAudioSession: NSObject {

    @objc public static let shared = SoundDropAudioSession()

    private let session = AVAudioSession.sharedInstance()
    private var isConfigured = false

    private override init() {
        super.init()
        registerNotifications()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    /**
     * Configures the iOS audio hardware for raw acoustic transceiver operation.
     */
    @objc public func configureAudioSession() throws {
        // Enforce PlayAndRecord category with speaker routing
        let categoryOptions: AVAudioSession.CategoryOptions = [
            .defaultToSpeaker,
            .allowBluetoothA2DP
        ]

        // CRITICAL FOR ACOUSTIC PHY:
        // .measurement mode disables system AGC, echo cancellation, and speech high-pass filters
        try session.setCategory(.playAndRecord, mode: .measurement, options: categoryOptions)

        // Low latency buffer configuration: 5ms buffer (240 samples at 48kHz)
        try session.setPreferredSampleRate(48000.0)
        try session.setPreferredIOBufferDuration(0.005)

        try session.setActive(true, options: .notifyOthersOnDeactivation)
        isConfigured = true
    }

    @objc public func deactivateAudioSession() {
        do {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            isConfigured = false
        } catch {
            NSLog("[SoundDropAudioSession] Error deactivating session: \(error.localizedDescription)")
        }
    }

    private func registerNotifications() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange),
            name: AVAudioSession.routeChangeNotification,
            object: nil
        )
    }

    @objc private func handleInterruption(notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
            return
        }

        switch type {
        case .began:
            NSLog("[SoundDropAudioSession] Audio session interrupted (phone call / alarm).")
        case .ended:
            if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt {
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                if options.contains(.shouldResume) {
                    try? configureAudioSession()
                }
            }
        @unknown default:
            break
        }
    }

    @objc private func handleRouteChange(notification: Notification) {
        guard let userInfo = notification.userInfo,
              let reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else {
            return
        }

        NSLog("[SoundDropAudioSession] Audio route changed. Reason: \(reason.rawValue)")
    }
}
