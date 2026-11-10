import '../models/link_metrics.dart';

/// Presentation model and formatting logic for the audio level meter widget.
class AudioLevelMeterViewModel {
  final double peakDbfs;
  final double rmsDbfs;
  final bool isClipping;

  const AudioLevelMeterViewModel({
    required this.peakDbfs,
    required this.rmsDbfs,
    required this.isClipping,
  });

  /// Normalized peak fraction [0.0 - 1.0].
  double get peakFraction => ((peakDbfs + 96.0) / 96.0).clamp(0.0, 1.0);

  /// Normalized RMS fraction [0.0 - 1.0].
  double get rmsFraction => ((rmsDbfs + 96.0) / 96.0).clamp(0.0, 1.0);

  String get peakFormatted => '${peakDbfs.toStringAsFixed(1)} dBFS';
  String get rmsFormatted => '${rmsDbfs.toStringAsFixed(1)} dBFS';

  String get statusColor {
    if (isClipping) return '#D32F2F'; // Red alert
    if (peakDbfs > -6.0) return '#F57C00'; // Amber warning
    if (peakDbfs > -40.0) return '#388E3C'; // Healthy Green
    return '#757575'; // Low / Silent Grey
  }
}

/// Presentation model for real link metrics indicator.
class LinkQualityViewModel {
  final LinkMetrics metrics;

  const LinkQualityViewModel(this.metrics);

  String get snrFormatted => '${metrics.snrMargin.toStringAsFixed(2)}x';
  String get correlationFormatted => '${(metrics.correlation * 100.0).toStringAsFixed(1)}%';
  String get fecFormatted => '${metrics.fecErrorsCorrected} symbols';

  String get gradeLabel {
    switch (metrics.grade) {
      case LinkQualityGrade.none:
        return 'NO SIGNAL';
      case LinkQualityGrade.poor:
        return 'POOR (HIGH CORRUPTION)';
      case LinkQualityGrade.fair:
        return 'FAIR (FEC ACTIVE)';
      case LinkQualityGrade.excellent:
        return 'EXCELLENT';
    }
  }
}
