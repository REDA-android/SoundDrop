// Dart / Flutter FFI Binding for SoundDrop Core
// Connects Flutter UI directly to compiled Rust core (libsounddrop_bridge.so / .dylib / .dll)

import 'dart:ffi' as ffi;
import 'dart:typed_data';
import 'package:ffi/ffi.dart';

// C struct representation
final class SoundDropKeypairC extends ffi.Struct {
  @ffi.Array(32)
  external ffi.Array<ffi.Uint8> publicKey;

  @ffi.Array(4)
  external ffi.Array<ffi.Uint8> recipientHash;
}

// C function signatures
typedef SoundDropGenerateIdentityC = ffi.Int32 Function(ffi.Pointer<SoundDropKeypairC>);
typedef SoundDropGenerateIdentityDart = int Function(ffi.Pointer<SoundDropKeypairC>);

typedef SoundDropVersionC = ffi.Pointer<Utf8> Function();
typedef SoundDropVersionDart = ffi.Pointer<Utf8> Function();

typedef SoundDropBuildRelayPacketC = ffi.Int32 Function(
  ffi.Uint16 sessionId,
  ffi.Pointer<ffi.Uint8> recipientHash,
  ffi.Uint8 ttl,
  ffi.Pointer<ffi.Uint8> payloadPtr,
  ffi.Size payloadLen,
  ffi.Pointer<ffi.Uint8> outBuf,
  ffi.Size outBufCapacity,
);
typedef SoundDropBuildRelayPacketDart = int Function(
  int sessionId,
  ffi.Pointer<ffi.Uint8> recipientHash,
  int ttl,
  ffi.Pointer<ffi.Uint8> payloadPtr,
  int payloadLen,
  ffi.Pointer<ffi.Uint8> outBuf,
  int outBufCapacity,
);

class SoundDropFlutterCore {
  final ffi.DynamicLibrary _dylib;
  late final SoundDropGenerateIdentityDart _generateIdentity;
  late final SoundDropVersionDart _version;
  late final SoundDropBuildRelayPacketDart _buildRelayPacket;

  SoundDropFlutterCore(String dynamicLibraryPath)
      : _dylib = ffi.DynamicLibrary.open(dynamicLibraryPath) {
    _generateIdentity = _dylib
        .lookupFunction<SoundDropGenerateIdentityC, SoundDropGenerateIdentityDart>(
            'sounddrop_generate_identity');
    _version = _dylib
        .lookupFunction<SoundDropVersionC, SoundDropVersionDart>('sounddrop_version');
    _buildRelayPacket = _dylib
        .lookupFunction<SoundDropBuildRelayPacketC, SoundDropBuildRelayPacketDart>(
            'sounddrop_build_relay_packet');
  }

  String getVersion() {
    final ptr = _version();
    return ptr.toDartString();
  }

  Map<String, Uint8List> generateEphemeralIdentity() {
    final keypairPtr = calloc<SoundDropKeypairC>();
    try {
      final res = _generateIdentity(keypairPtr);
      if (res != 0) throw Exception('Failed to generate keypair: $res');

      final pubKey = Uint8List(32);
      for (int i = 0; i < 32; i++) {
        pubKey[i] = keypairPtr.ref.publicKey[i];
      }

      final hash = Uint8List(4);
      for (int i = 0; i < 4; i++) {
        hash[i] = keypairPtr.ref.recipientHash[i];
      }

      return {'publicKey': pubKey, 'recipientHash': hash};
    } finally {
      calloc.free(keypairPtr);
    }
  }
}
