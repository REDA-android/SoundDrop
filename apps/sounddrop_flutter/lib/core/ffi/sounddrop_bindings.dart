import 'dart:ffi';
import 'dart:io';
import 'dart:typed_data';
import 'package:ffi/ffi.dart';

// Native function typedefs
typedef VersionFunc = Pointer<Utf8> Function();

typedef EncodeMessageNative = Int32 Function(
    Pointer<Utf8> message,
    Uint8 seqNum,
    Uint8 ultrasonic,
    Pointer<Pointer<Float>> outPcm,
    Pointer<Uint32> outLen);
typedef EncodeMessageDart = int Function(
    Pointer<Utf8> message,
    int seqNum,
    int ultrasonic,
    Pointer<Pointer<Float>> outPcm,
    Pointer<Uint32> outLen);

typedef FreePcmNative = Void Function(Pointer<Float> pcm, Uint32 len);
typedef FreePcmDart = void Function(Pointer<Float> pcm, int len);

typedef DecodePcmNative = Int32 Function(
    Pointer<Float> pcm,
    Uint32 len,
    Uint8 ultrasonic,
    Pointer<Utf8> outBuf,
    Uint32 maxBufLen,
    Pointer<Float> outSnr,
    Pointer<Float> outCorr,
    Pointer<Uint32> outFecCorrected);
typedef DecodePcmDart = int Function(
    Pointer<Float> pcm,
    int len,
    int ultrasonic,
    Pointer<Utf8> outBuf,
    int maxBufLen,
    Pointer<Float> outSnr,
    Pointer<Float> outCorr,
    Pointer<Uint32> outFecCorrected);

typedef ComputeSpectrumNative = Int32 Function(
    Pointer<Float> samples,
    Uint32 numSamples,
    Pointer<Float> outMagnitudes,
    Uint32 numBins);
typedef ComputeSpectrumDart = int Function(
    Pointer<Float> samples,
    int numSamples,
    Pointer<Float> outMagnitudes,
    int numBins);

typedef ComputeMeterNative = Int32 Function(
    Pointer<Float> samples,
    Uint32 len,
    Pointer<Float> outPeak,
    Pointer<Float> outRms,
    Pointer<Uint8> outClipping);
typedef ComputeMeterDart = int Function(
    Pointer<Float> samples,
    int len,
    Pointer<Float> outPeak,
    Pointer<Float> outRms,
    Pointer<Uint8> outClipping);

typedef GenerateSasNative = Int32 Function(
    Pointer<Uint8> digest32,
    Pointer<Utf8> outPin,
    Uint32 maxPinLen,
    Pointer<Utf8> outWords,
    Uint32 maxWordsLen);
typedef GenerateSasDart = int Function(
    Pointer<Uint8> digest32,
    Pointer<Utf8> outPin,
    int maxPinLen,
    Pointer<Utf8> outWords,
    int maxWordsLen);

typedef RunFileTransferNative = Pointer<Utf8> Function(
    Pointer<Utf8> filepath,
    Pointer<Utf8> outDir,
    Pointer<Utf8> cacheDir,
    Uint32 chunkSize,
    Float dataLoss,
    Float ackLoss,
    Float snrDb);
typedef RunFileTransferDart = Pointer<Utf8> Function(
    Pointer<Utf8> filepath,
    Pointer<Utf8> outDir,
    Pointer<Utf8> cacheDir,
    int chunkSize,
    double dataLoss,
    double ackLoss,
    double snrDb);

typedef RunHybridTransferNative = Pointer<Utf8> Function(
    Pointer<Utf8> filepath,
    Pointer<Utf8> outDir,
    Pointer<Utf8> cacheDir,
    Uint32 chunkSize,
    Uint8 simulatedWifiBlocked);
typedef RunHybridTransferDart = Pointer<Utf8> Function(
    Pointer<Utf8> filepath,
    Pointer<Utf8> outDir,
    Pointer<Utf8> cacheDir,
    int chunkSize,
    int simulatedWifiBlocked);

typedef FreeStringNative = Void Function(Pointer<Utf8> ptr);
typedef FreeStringDart = void Function(Pointer<Utf8> ptr);

/// High-level Dart interface to the native SoundDrop Rust core library.
class SoundDropBindings {
  late final DynamicLibrary _lib;

  late final VersionFunc _version;
  late final EncodeMessageDart _encodeMessage;
  late final FreePcmDart _freePcm;
  late final DecodePcmDart _decodePcm;
  late final ComputeSpectrumDart _computeSpectrum;
  late final ComputeMeterDart _computeMeter;
  late final GenerateSasDart _generateSas;
  late final RunFileTransferDart _runFileTransfer;
  late final RunHybridTransferDart _runHybridTransfer;
  late final FreeStringDart _freeString;

  SoundDropBindings([DynamicLibrary? customLib]) {
    _lib = customLib ?? _openLibrary();

    _version = _lib.lookupFunction<VersionFunc, VersionFunc>('sounddrop_ffi_version');
    _encodeMessage = _lib.lookupFunction<EncodeMessageNative, EncodeMessageDart>('sounddrop_ffi_encode_message');
    _freePcm = _lib.lookupFunction<FreePcmNative, FreePcmDart>('sounddrop_ffi_free_pcm');
    _decodePcm = _lib.lookupFunction<DecodePcmNative, DecodePcmDart>('sounddrop_ffi_decode_pcm');
    _computeSpectrum = _lib.lookupFunction<ComputeSpectrumNative, ComputeSpectrumDart>('sounddrop_ffi_compute_spectrum');
    _computeMeter = _lib.lookupFunction<ComputeMeterNative, ComputeMeterDart>('sounddrop_ffi_compute_meter');
    _generateSas = _lib.lookupFunction<GenerateSasNative, GenerateSasDart>('sounddrop_ffi_generate_sas');
    _runFileTransfer = _lib.lookupFunction<RunFileTransferNative, RunFileTransferDart>('sounddrop_ffi_run_file_transfer');
    _runHybridTransfer = _lib.lookupFunction<RunHybridTransferNative, RunHybridTransferDart>('sounddrop_ffi_run_hybrid_transfer');
    _freeString = _lib.lookupFunction<FreeStringNative, FreeStringDart>('sounddrop_ffi_free_string');
  }

  static DynamicLibrary _openLibrary() {
    if (Platform.isLinux) {
      // Check local project build directories first
      final candidates = [
        'target/release/libsounddrop_ffi.so',
        '../../target/release/libsounddrop_ffi.so',
        'libsounddrop_ffi.so',
      ];
      for (final path in candidates) {
        if (File(path).existsSync()) {
          return DynamicLibrary.open(path);
        }
      }
      return DynamicLibrary.open('libsounddrop_ffi.so');
    } else if (Platform.isMacOS) {
      return DynamicLibrary.open('libsounddrop_ffi.dylib');
    } else if (Platform.isWindows) {
      return DynamicLibrary.open('sounddrop_ffi.dll');
    } else if (Platform.isAndroid) {
      return DynamicLibrary.open('libsounddrop_ffi.so');
    } else if (Platform.isIOS) {
      return DynamicLibrary.process();
    }
    throw UnsupportedError('Unsupported operating system: ${Platform.operatingSystem}');
  }

  /// Returns the native Rust core library version string.
  String getVersion() {
    final ptr = _version();
    return ptr.toDartString();
  }

  /// Encodes a message string into a Float32List of 48kHz PCM audio samples.
  Float32List encodeMessage(String message, {int seqNum = 0, bool ultrasonic = false}) {
    final msgPtr = message.toNativeUtf8();
    final outPcmPtr = calloc<Pointer<Float>>();
    final outLenPtr = calloc<Uint32>();

    try {
      final res = _encodeMessage(
        msgPtr,
        seqNum,
        ultrasonic ? 1 : 0,
        outPcmPtr,
        outLenPtr,
      );

      if (res != 0) {
        throw StateError('Acoustic encoding failed with error code $res');
      }

      final pcmArrayPtr = outPcmPtr.value;
      final len = outLenPtr.value;

      final floatList = Float32List(len);
      for (var i = 0; i < len; i++) {
        floatList[i] = pcmArrayPtr[i];
      }

      _freePcm(pcmArrayPtr, len);
      return floatList;
    } finally {
      calloc.free(msgPtr);
      calloc.free(outPcmPtr);
      calloc.free(outLenPtr);
    }
  }

  /// Demodulates 48kHz audio samples into a decoded message string and link quality metrics.
  DecodeResult decodePcm(Float32List samples, {bool ultrasonic = false}) {
    final pcmPtr = calloc<Float>(samples.length);
    for (var i = 0; i < samples.length; i++) {
      pcmPtr[i] = samples[i];
    }

    final outBuf = calloc<Uint8>(512).cast<Utf8>();
    final outSnr = calloc<Float>();
    final outCorr = calloc<Float>();
    final outFec = calloc<Uint32>();

    try {
      final res = _decodePcm(
        pcmPtr,
        samples.length,
        ultrasonic ? 1 : 0,
        outBuf,
        512,
        outSnr,
        outCorr,
        outFec,
      );

      if (res != 0) {
        throw StateError('Acoustic demodulation failed (code: $res, signal not detected or corrupted)');
      }

      final message = outBuf.toDartString();
      return DecodeResult(
        message: message,
        snrMargin: outSnr.value,
        correlation: outCorr.value,
        fecErrorsCorrected: outFec.value,
      );
    } finally {
      calloc.free(pcmPtr);
      calloc.free(outBuf);
      calloc.free(outSnr);
      calloc.free(outCorr);
      calloc.free(outFec);
    }
  }

  /// Computes genuine FFT frequency spectrum bins (dBFS) for the Waterfall UI.
  Float32List computeSpectrum(Float32List samples, int numBins) {
    final numSamples = numBins * 2;
    final samplesPtr = calloc<Float>(numSamples);
    final count = samples.length < numSamples ? samples.length : numSamples;
    for (var i = 0; i < count; i++) {
      samplesPtr[i] = samples[i];
    }
    for (var i = count; i < numSamples; i++) {
      samplesPtr[i] = 0.0;
    }

    final outBinsPtr = calloc<Float>(numBins);
    try {
      final res = _computeSpectrum(samplesPtr, numSamples, outBinsPtr, numBins);
      if (res != 0) {
        return Float32List(numBins);
      }

      final result = Float32List(numBins);
      for (var i = 0; i < numBins; i++) {
        result[i] = outBinsPtr[i];
      }
      return result;
    } finally {
      calloc.free(samplesPtr);
      calloc.free(outBinsPtr);
    }
  }

  /// Computes audio levels (Peak dBFS, RMS dBFS, clipping).
  MeterResult computeMeter(Float32List samples) {
    if (samples.isEmpty) {
      return MeterResult(peakDbfs: -96.0, rmsDbfs: -96.0, isClipping: false);
    }

    final samplesPtr = calloc<Float>(samples.length);
    for (var i = 0; i < samples.length; i++) {
      samplesPtr[i] = samples[i];
    }

    final outPeak = calloc<Float>();
    final outRms = calloc<Float>();
    final outClip = calloc<Uint8>();

    try {
      final res = _computeMeter(samplesPtr, samples.length, outPeak, outRms, outClip);
      if (res != 0) {
        return MeterResult(peakDbfs: -96.0, rmsDbfs: -96.0, isClipping: false);
      }

      return MeterResult(
        peakDbfs: outPeak.value,
        rmsDbfs: outRms.value,
        isClipping: outClip.value != 0,
      );
    } finally {
      calloc.free(samplesPtr);
      calloc.free(outPeak);
      calloc.free(outRms);
      calloc.free(outClip);
    }
  }

  /// Generates Short Authentication String (SAS) from 32-byte digest.
  SasResult generateSas(Uint8List digest32) {
    if (digest32.length != 32) {
      throw ArgumentError('Digest must be exactly 32 bytes');
    }

    final digestPtr = calloc<Uint8>(32);
    for (var i = 0; i < 32; i++) {
      digestPtr[i] = digest32[i];
    }

    final pinBuf = calloc<Uint8>(16).cast<Utf8>();
    final wordsBuf = calloc<Uint8>(128).cast<Utf8>();

    try {
      final res = _generateSas(digestPtr, pinBuf, 16, wordsBuf, 128);
      if (res != 0) {
        throw StateError('SAS generation failed: code $res');
      }

      return SasResult(
        pin: pinBuf.toDartString(),
        words: wordsBuf.toDartString(),
      );
    } finally {
      calloc.free(digestPtr);
      calloc.free(pinBuf);
      calloc.free(wordsBuf);
    }
  }

  /// Executes an end-to-end encrypted file transfer through the native core engine.
  String runFileTransfer({
    required String filePath,
    required String outputDir,
    required String cacheDir,
    int chunkSize = 32,
    double dataLoss = 0.0,
    double ackLoss = 0.0,
    double snrDb = 25.0,
  }) {
    final filePtr = filePath.toNativeUtf8();
    final outDirPtr = outputDir.toNativeUtf8();
    final cacheDirPtr = cacheDir.toNativeUtf8();

    try {
      final jsonPtr = _runFileTransfer(
        filePtr,
        outDirPtr,
        cacheDirPtr,
        chunkSize,
        dataLoss,
        ackLoss,
        snrDb,
      );

      if (jsonPtr.address == 0) {
        throw StateError('Null response from file transfer execution');
      }

      final jsonStr = jsonPtr.toDartString();
      _freeString(jsonPtr);
      return jsonStr;
    } finally {
      calloc.free(filePtr);
      calloc.free(outDirPtr);
      calloc.free(cacheDirPtr);
    }
  }

  /// Executes Milestone 7 hybrid acoustic bootstrap -> Wi-Fi transfer session.
  String runHybridTransfer({
    required String filepath,
    required String outDir,
    required String cacheDir,
    int chunkSize = 64,
    bool simulatedWifiBlocked = false,
  }) {
    final filePtr = filepath.toNativeUtf8();
    final outDirPtr = outDir.toNativeUtf8();
    final cacheDirPtr = cacheDir.toNativeUtf8();

    try {
      final jsonPtr = _runHybridTransfer(
        filePtr,
        outDirPtr,
        cacheDirPtr,
        chunkSize,
        simulatedWifiBlocked ? 1 : 0,
      );

      if (jsonPtr.address == 0) {
        throw StateError('Null response from hybrid transfer execution');
      }

      final jsonStr = jsonPtr.toDartString();
      _freeString(jsonPtr);
      return jsonStr;
    } finally {
      calloc.free(filePtr);
      calloc.free(outDirPtr);
      calloc.free(cacheDirPtr);
    }
  }
}

class DecodeResult {
  final String message;
  final double snrMargin;
  final double correlation;
  final int fecErrorsCorrected;

  DecodeResult({
    required this.message,
    required this.snrMargin,
    required this.correlation,
    required this.fecErrorsCorrected,
  });
}

class MeterResult {
  final double peakDbfs;
  final double rmsDbfs;
  final bool isClipping;

  MeterResult({
    required this.peakDbfs,
    required this.rmsDbfs,
    required this.isClipping,
  });
}

class SasResult {
  final String pin;
  final String words;

  SasResult({
    required this.pin,
    required this.words,
  });
}
