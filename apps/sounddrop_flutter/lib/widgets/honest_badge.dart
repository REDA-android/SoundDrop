/// Badge distinguishing implemented functionality from planned/unimplemented features.
/// Complies with SoundDrop Non-Negotiable Rule:
/// "If something is not implemented, clearly label it NOT IMPLEMENTED."
enum ImplementationStatus {
  productionReady,
  verifiedHardware,
  compiledAndTested,
  notImplemented,
}

class HonestFeatureBadge {
  final String label;
  final ImplementationStatus status;

  const HonestFeatureBadge({
    required this.label,
    required this.status,
  });

  String get displayText {
    switch (status) {
      case ImplementationStatus.productionReady:
        return 'PRODUCTION READY';
      case ImplementationStatus.verifiedHardware:
        return 'HARDWARE VERIFIED';
      case ImplementationStatus.compiledAndTested:
        return 'REAL IMPLEMENTATION (TESTED)';
      case ImplementationStatus.notImplemented:
        return 'NOT IMPLEMENTED';
    }
  }

  String get hexColor {
    switch (status) {
      case ImplementationStatus.productionReady:
      case ImplementationStatus.verifiedHardware:
        return '#2E7D32'; // Forest Green
      case ImplementationStatus.compiledAndTested:
        return '#0288D1'; // Teal Blue
      case ImplementationStatus.notImplemented:
        return '#D32F2F'; // Warning Red
    }
  }
}
