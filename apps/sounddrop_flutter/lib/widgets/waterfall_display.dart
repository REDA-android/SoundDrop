import 'dart:typed_data';

/// Waterfall spectral line containing genuine FFT magnitude bins.
class WaterfallLine {
  final Float32List magnitudes;
  final DateTime timestamp;

  WaterfallLine(this.magnitudes) : timestamp = DateTime.now();
}

/// Buffer storing rolling historical waterfall spectral rows.
class WaterfallHistory {
  final int maxLines;
  final List<WaterfallLine> _lines = [];

  WaterfallHistory({this.maxLines = 60});

  List<WaterfallLine> get lines => List.unmodifiable(_lines);

  void addLine(Float32List magnitudes) {
    if (_lines.length >= maxLines) {
      _lines.removeAt(0);
    }
    _lines.add(WaterfallLine(magnitudes));
  }

  void clear() {
    _lines.clear();
  }

  /// Maps a dBFS value [-96.0, 0.0] to a normalized spectral intensity [0.0, 1.0].
  static double normalizeDbfs(double dbfs) {
    return ((dbfs + 96.0) / 96.0).clamp(0.0, 1.0);
  }

  /// Converts a spectral intensity [0.0, 1.0] to RGB components (Dark Blue -> Cyan -> Green -> Yellow -> Red).
  static List<int> intensityToRgb(double intensity) {
    final v = intensity.clamp(0.0, 1.0);
    if (v < 0.25) {
      // Dark Blue to Cyan
      final f = v / 0.25;
      return [0, (f * 180).toInt(), (100 + f * 155).toInt()];
    } else if (v < 0.5) {
      // Cyan to Green
      final f = (v - 0.25) / 0.25;
      return [0, (180 + f * 75).toInt(), (255 * (1.0 - f)).toInt()];
    } else if (v < 0.75) {
      // Green to Yellow
      final f = (v - 0.5) / 0.25;
      return [(f * 255).toInt(), 255, 0];
    } else {
      // Yellow to Red
      final f = (v - 0.75) / 0.25;
      return [255, (255 * (1.0 - f)).toInt(), 0];
    }
  }
}
