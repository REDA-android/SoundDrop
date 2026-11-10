/// Real-time physical layer link quality metrics.
/// All values represent genuine measurements computed by matched filters and Reed-Solomon decoders.
class LinkMetrics {
  /// Signal-to-Noise Ratio margin multiplier over energy threshold (e.g., 2.5x - 20.0x).
  final double snrMargin;

  /// Normalized Cross-Correlation (NCC) peak correlation score [0.0 - 1.0].
  final double correlation;

  /// Number of symbol errors corrected by Reed-Solomon GF(2^8) FEC in the current frame.
  final int fecErrorsCorrected;

  /// Peak amplitude relative to full scale (-96.0 dBFS to 0.0 dBFS).
  final double peakDbfs;

  /// Root Mean Square energy relative to full scale.
  final double rmsDbfs;

  /// True if digital audio input is saturated (clipping >= 0.999).
  final bool isClipping;

  const LinkMetrics({
    this.snrMargin = 0.0,
    this.correlation = 0.0,
    this.fecErrorsCorrected = 0,
    this.peakDbfs = -96.0,
    this.rmsDbfs = -96.0,
    this.isClipping = false,
  });

  LinkQualityGrade get grade {
    if (correlation < 0.3) return LinkQualityGrade.none;
    if (snrMargin < 1.5 || fecErrorsCorrected > 4) return LinkQualityGrade.poor;
    if (snrMargin < 3.0 || fecErrorsCorrected > 0) return LinkQualityGrade.fair;
    return LinkQualityGrade.excellent;
  }
}

enum LinkQualityGrade {
  none,
  poor,
  fair,
  excellent,
}
