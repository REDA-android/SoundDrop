import 'dart:typed_data';
import 'package:sounddrop_flutter/models/link_metrics.dart';
import 'package:sounddrop_flutter/screens/settings_screen.dart';
import 'package:sounddrop_flutter/widgets/audio_level_meter.dart';
import 'package:sounddrop_flutter/widgets/honest_badge.dart';
import 'package:sounddrop_flutter/widgets/waterfall_display.dart';
import 'package:test/test.dart';

void main() {
  group('SoundDrop Models & Honest UI Widgets Tests', () {
    test('LinkMetrics correctly computes link quality grades', () {
      const none = LinkMetrics(correlation: 0.1);
      expect(none.grade, equals(LinkQualityGrade.none));

      const poor = LinkMetrics(correlation: 0.8, snrMargin: 1.2, fecErrorsCorrected: 6);
      expect(poor.grade, equals(LinkQualityGrade.poor));

      const fair = LinkMetrics(correlation: 0.85, snrMargin: 2.2, fecErrorsCorrected: 2);
      expect(fair.grade, equals(LinkQualityGrade.fair));

      const excellent = LinkMetrics(correlation: 0.95, snrMargin: 4.5, fecErrorsCorrected: 0);
      expect(excellent.grade, equals(LinkQualityGrade.excellent));
    });

    test('AudioLevelMeterViewModel formats dBFS and status colors', () {
      const normal = AudioLevelMeterViewModel(peakDbfs: -18.0, rmsDbfs: -24.0, isClipping: false);
      expect(normal.peakFormatted, equals('-18.0 dBFS'));
      expect(normal.rmsFormatted, equals('-24.0 dBFS'));
      expect(normal.statusColor, equals('#388E3C')); // Healthy green

      const clip = AudioLevelMeterViewModel(peakDbfs: 0.0, rmsDbfs: -3.0, isClipping: true);
      expect(clip.statusColor, equals('#D32F2F')); // Alert red
    });

    test('WaterfallHistory buffers lines and maps spectral colormaps', () {
      final history = WaterfallHistory(maxLines: 5);
      expect(history.lines, isEmpty);

      for (var i = 0; i < 7; i++) {
        history.addLine(Float32List(128));
      }
      expect(history.lines.length, equals(5));

      final rgbLow = WaterfallHistory.intensityToRgb(0.1);
      expect(rgbLow.length, equals(3));

      final rgbHigh = WaterfallHistory.intensityToRgb(0.9);
      expect(rgbHigh.length, equals(3));
      expect(rgbHigh[0], equals(255)); // Red dominant
    });

    test('HonestFeatureBadge strictly distinguishes real implementation from not implemented', () {
      const real = HonestFeatureBadge(
        label: 'Acoustic Core',
        status: ImplementationStatus.compiledAndTested,
      );
      expect(real.displayText, equals('REAL IMPLEMENTATION (TESTED)'));
      expect(real.hexColor, equals('#0288D1'));

      const unimp = HonestFeatureBadge(
        label: 'Wi-Fi Handover',
        status: ImplementationStatus.notImplemented,
      );
      expect(unimp.displayText, equals('NOT IMPLEMENTED'));
      expect(unimp.hexColor, equals('#D32F2F'));
    });

    test('SettingsScreenController system feature audit strictly marks un-implemented milestones', () {
      final controller = SettingsScreenController();
      final audit = controller.systemFeatureAudit;

      final wifiHandover = audit.firstWhere((e) => e.title.contains('Wi-Fi Transport Handover'));
      expect(wifiHandover.status, equals(ImplementationStatus.compiledAndTested));
      expect(wifiHandover.cratePath, equals('crates/sounddrop_hybrid'));

      final meshRelay = audit.firstWhere((e) => e.title.contains('Mesh Relay'));
      expect(meshRelay.status, equals(ImplementationStatus.notImplemented));

      final crypto = audit.firstWhere((e) => e.title.contains('End-to-End Cryptography'));
      expect(crypto.status, equals(ImplementationStatus.compiledAndTested));
    });
  });
}
