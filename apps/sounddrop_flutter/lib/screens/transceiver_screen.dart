import '../providers/acoustic_session_notifier.dart';
import '../widgets/audio_level_meter.dart';
import '../widgets/honest_badge.dart';
import '../widgets/waterfall_display.dart';

/// Controller and state manager for the acoustic transceiver screen.
class TransceiverScreenController {
  final AcousticSessionNotifier session;
  final WaterfallHistory waterfall = WaterfallHistory(maxLines: 60);

  TransceiverScreenController(this.session) {
    session.spectrumStream.listen((bins) {
      waterfall.addLine(bins);
    });
  }

  HonestFeatureBadge get badge => const HonestFeatureBadge(
        label: 'Acoustic 16-FSK & CSS Transceiver',
        status: ImplementationStatus.compiledAndTested,
      );

  AudioLevelMeterViewModel get meterViewModel {
    final m = session.metrics;
    return AudioLevelMeterViewModel(
      peakDbfs: m.peakDbfs,
      rmsDbfs: m.rmsDbfs,
      isClipping: m.isClipping,
    );
  }

  LinkQualityViewModel get linkViewModel => LinkQualityViewModel(session.metrics);

  void sendText(String text) {
    if (text.trim().isEmpty) return;
    session.transmitMessage(text);
  }

  void toggleUltrasonic(bool value) {
    session.setUltrasonic(value);
  }
}
