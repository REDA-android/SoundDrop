import 'dart:async';
import 'dart:typed_data';
import '../core/ffi/sounddrop_bindings.dart';
import '../models/link_metrics.dart';

/// Notifier driving the acoustic transceiver screen:
/// - Real-time waterfall spectrum FFT bins
/// - Signal level metering (Peak, RMS, Clipping)
/// - Message transmission and reception
class AcousticSessionNotifier {
  final SoundDropBindings _bindings;

  LinkMetrics _metrics = const LinkMetrics();
  Float32List _spectrumBins = Float32List(128);
  bool _isListening = false;
  bool _isUltrasonic = false;
  String _lastReceivedMessage = '';

  final _metricsController = StreamController<LinkMetrics>.broadcast();
  final _spectrumController = StreamController<Float32List>.broadcast();
  final _messageController = StreamController<String>.broadcast();

  AcousticSessionNotifier([SoundDropBindings? bindings])
      : _bindings = bindings ?? SoundDropBindings();

  LinkMetrics get metrics => _metrics;
  Float32List get spectrumBins => _spectrumBins;
  bool get isListening => _isListening;
  bool get isUltrasonic => _isUltrasonic;
  String get lastReceivedMessage => _lastReceivedMessage;

  Stream<LinkMetrics> get metricsStream => _metricsController.stream;
  Stream<Float32List> get spectrumStream => _spectrumController.stream;
  Stream<String> get messageStream => _messageController.stream;

  void setUltrasonic(bool enabled) {
    _isUltrasonic = enabled;
  }

  void startListening() {
    _isListening = true;
  }

  void stopListening() {
    _isListening = false;
  }

  /// Ingests a new block of raw audio PCM float samples from native mic stream or loopback,
  /// computes genuine FFT spectrum bins, and updates real-time meters.
  void ingestAudioSamples(Float32List samples) {
    if (samples.isEmpty) return;

    // 1. Compute genuine 128-bin FFT spectrum for Waterfall display
    _spectrumBins = _bindings.computeSpectrum(samples, 128);
    _spectrumController.add(_spectrumBins);

    // 2. Compute audio meter (Peak dBFS, RMS dBFS, Clipping)
    final meter = _bindings.computeMeter(samples);

    _metrics = LinkMetrics(
      snrMargin: _metrics.snrMargin,
      correlation: _metrics.correlation,
      fecErrorsCorrected: _metrics.fecErrorsCorrected,
      peakDbfs: meter.peakDbfs,
      rmsDbfs: meter.rmsDbfs,
      isClipping: meter.isClipping,
    );
    _metricsController.add(_metrics);
  }

  /// Encodes and modulates a message string into 48kHz audio PCM samples.
  Float32List transmitMessage(String text, {int seq = 0}) {
    final pcm = _bindings.encodeMessage(text, seqNum: seq, ultrasonic: _isUltrasonic);
    // Feed the emitted PCM to spectrum so the waterfall shows the transmission
    ingestAudioSamples(pcm);
    return pcm;
  }

  /// Demodulates audio samples and updates reception metrics if a frame is decoded.
  bool processReceivedPcm(Float32List pcm) {
    try {
      final res = _bindings.decodePcm(pcm, ultrasonic: _isUltrasonic);
      _lastReceivedMessage = res.message;
      _metrics = LinkMetrics(
        snrMargin: res.snrMargin,
        correlation: res.correlation,
        fecErrorsCorrected: res.fecErrorsCorrected,
        peakDbfs: _metrics.peakDbfs,
        rmsDbfs: _metrics.rmsDbfs,
        isClipping: _metrics.isClipping,
      );
      _metricsController.add(_metrics);
      _messageController.add(_lastReceivedMessage);
      return true;
    } catch (_) {
      return false;
    }
  }

  void dispose() {
    _metricsController.close();
    _spectrumController.close();
    _messageController.close();
  }
}
