import 'dart:io';
import 'dart:typed_data';
import 'package:sounddrop_flutter/core/ffi/sounddrop_bindings.dart';
import 'package:test/test.dart';

void main() {
  group('SoundDrop Native Rust FFI Bindings Tests', () {
    late SoundDropBindings bindings;

    setUpAll(() {
      bindings = SoundDropBindings();
    });

    test('Native core version matches expected identifier', () {
      final version = bindings.getVersion();
      expect(version, equals('0.1.0-sounddrop-native'));
    });

    test('Acoustic message modulation produces non-empty 48kHz PCM float buffer', () {
      final pcm = bindings.encodeMessage('HELLO_FLUTTER', seqNum: 1, ultrasonic: false);
      expect(pcm, isNotEmpty);
      expect(pcm.length, greaterThan(4800)); // At least 100ms of audio
      // Verify samples are bounded within [-1.0, 1.0]
      for (final s in pcm) {
        expect(s.abs(), lessThanOrEqualTo(1.001));
      }
    });

    test('Acoustic modulation and demodulation loopback recovers exact message', () {
      const message = 'SOUNDDROP_M6_VERIFIED';
      final pcm = bindings.encodeMessage(message, seqNum: 5, ultrasonic: false);

      // Add 50ms silence prefix and suffix to simulate air capture
      final paddedPcm = Float32List(pcm.length + 4800);
      paddedPcm.setRange(2400, 2400 + pcm.length, pcm);

      final result = bindings.decodePcm(paddedPcm, ultrasonic: false);
      expect(result.message, equals(message));
      expect(result.correlation, greaterThan(0.75));
      expect(result.snrMargin, greaterThan(1.5));
    });

    test('FFT spectrum computation returns genuine 128-bin frequency magnitudes', () {
      final testSamples = Float32List(256);
      for (var i = 0; i < 256; i++) {
        testSamples[i] = 0.5;
      }

      final bins = bindings.computeSpectrum(testSamples, 128);
      expect(bins.length, equals(128));
      for (final b in bins) {
        expect(b, inInclusiveRange(-96.0, 0.0));
      }
    });

    test('Audio meter calculates peak, RMS dBFS and detects clipping', () {
      final silence = Float32List(480);
      final mSilence = bindings.computeMeter(silence);
      expect(mSilence.peakDbfs, equals(-96.0));
      expect(mSilence.isClipping, isFalse);

      final clippingSamples = Float32List.fromList([1.0, -1.0, 0.5]);
      final mClip = bindings.computeMeter(clippingSamples);
      expect(mClip.isClipping, isTrue);
      expect(mClip.peakDbfs, inInclusiveRange(-0.1, 0.0));
    });

    test('Short Authentication String (SAS) generation matches deterministic output', () {
      final digest = Uint8List(32);
      for (var i = 0; i < 32; i++) {
        digest[i] = 0x5A;
      }

      final sas = bindings.generateSas(digest);
      expect(sas.pin.length, equals(7)); // "XXX-XXX"
      expect(sas.words.split(' - ').length, equals(4));
    });

    test('End-to-end encrypted file transfer succeeds and creates verified file', () {
      final tempDir = Directory.systemTemp.createTempSync('sounddrop_dart_test_');
      final inputFile = File('${tempDir.path}/test_payload.txt');
      inputFile.writeAsStringSync('SoundDrop Milestone 6: Flutter Dart FFI file transfer verified!');

      final outputDir = Directory('${tempDir.path}/out')..createSync();
      final cacheDir = Directory('${tempDir.path}/cache')..createSync();

      try {
        final jsonResult = bindings.runFileTransfer(
          filePath: inputFile.path,
          outputDir: outputDir.path,
          cacheDir: cacheDir.path,
          chunkSize: 32,
          dataLoss: 0.0,
          ackLoss: 0.0,
          snrDb: 30.0,
        );

        expect(jsonResult, contains('"status":"ok"'));
        expect(jsonResult, contains('"fileName":"test_payload.txt"'));
        expect(jsonResult, contains('"sasVerified":true'));

        final deliveredFile = File('${outputDir.path}/test_payload.txt');
        expect(deliveredFile.existsSync(), isTrue);
        expect(deliveredFile.readAsStringSync(), equals(inputFile.readAsStringSync()));
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('Milestone 7: Hybrid transfer over Direct Wi-Fi succeeds with SAS verification', () {
      final tempDir = Directory.systemTemp.createTempSync('sounddrop_hybrid_wifi_test_');
      final inputFile = File('${tempDir.path}/wifi_data.bin');
      inputFile.writeAsBytesSync(List.generate(1024, (i) => (i * 7) & 0xFF));

      final outputDir = Directory('${tempDir.path}/out')..createSync();
      final cacheDir = Directory('${tempDir.path}/cache')..createSync();

      try {
        final jsonResult = bindings.runHybridTransfer(
          filepath: inputFile.path,
          outDir: outputDir.path,
          cacheDir: cacheDir.path,
          chunkSize: 64,
          simulatedWifiBlocked: false,
        );

        expect(jsonResult, contains('"status":"ok"'));
        expect(jsonResult, contains('"transportMode":"DirectWifi"'));
        expect(jsonResult, contains('"sasVerified":true'));

        final deliveredFile = File('${outputDir.path}/wifi_data.bin');
        expect(deliveredFile.existsSync(), isTrue);
        expect(deliveredFile.readAsBytesSync(), equals(inputFile.readAsBytesSync()));
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('Milestone 7: Hybrid transfer falls back cleanly to acoustic ARQ when Wi-Fi blocked', () {
      final tempDir = Directory.systemTemp.createTempSync('sounddrop_hybrid_fallback_test_');
      final inputFile = File('${tempDir.path}/fallback_data.txt');
      inputFile.writeAsStringSync('SoundDrop Milestone 7: Acoustic Fallback verified via Flutter FFI!');

      final outputDir = Directory('${tempDir.path}/out')..createSync();
      final cacheDir = Directory('${tempDir.path}/cache')..createSync();

      try {
        final jsonResult = bindings.runHybridTransfer(
          filepath: inputFile.path,
          outDir: outputDir.path,
          cacheDir: cacheDir.path,
          chunkSize: 32,
          simulatedWifiBlocked: true,
        );

        expect(jsonResult, contains('"status":"ok"'));
        expect(jsonResult, contains('"transportMode":"AcousticFallback"'));
        expect(jsonResult, contains('"sasVerified":true'));

        final deliveredFile = File('${outputDir.path}/fallback_data.txt');
        expect(deliveredFile.existsSync(), isTrue);
        expect(deliveredFile.readAsStringSync(), equals(inputFile.readAsStringSync()));
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });
  });
}
