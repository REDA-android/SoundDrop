import 'dart:isolate';

import '../core/ffi/sounddrop_bindings.dart';

/// Real acoustic I/O (speaker / microphone) behind an interface so the UI can be tested
/// without audio hardware. The default implementation calls the native Rust core in a
/// background isolate because both operations block for seconds.
abstract class AirgapService {
  Future<void> transmit(String message, AcousticProfile profile);
  Future<DecodeResult> receive(double durationSec, AcousticProfile profile);
}

class NativeAirgapService implements AirgapService {
  const NativeAirgapService();

  @override
  Future<void> transmit(String message, AcousticProfile profile) {
    return Isolate.run(() => SoundDropBindings().transmitAirgap(message, profile: profile));
  }

  @override
  Future<DecodeResult> receive(double durationSec, AcousticProfile profile) {
    return Isolate.run(
      () => SoundDropBindings().receiveAirgap(durationSec: durationSec, profile: profile),
    );
  }
}
