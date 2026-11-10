import '../widgets/honest_badge.dart';

class FeatureAuditEntry {
  final String title;
  final String milestone;
  final String cratePath;
  final ImplementationStatus status;
  final String description;

  const FeatureAuditEntry({
    required this.title,
    required this.milestone,
    required this.cratePath,
    required this.status,
    required this.description,
  });
}

/// Controller and data source for the Settings & Engineering Audit screen.
class SettingsScreenController {
  bool isUltrasonicEnabled = false;
  double channelSnrThresholdDb = 15.0;

  List<FeatureAuditEntry> get systemFeatureAudit => const [
        FeatureAuditEntry(
          title: 'Physical Acoustic PHY & Link (16-FSK & CSS)',
          milestone: 'Milestone 1',
          cratePath: 'crates/sounddrop_phy, crates/sounddrop_dsp',
          status: ImplementationStatus.compiledAndTested,
          description: 'Dual-band audible (1.5-4.5 kHz) and ultrasonic (17.5-20.5 kHz) modulation with Reed-Solomon FEC and NCC matched filters.',
        ),
        FeatureAuditEntry(
          title: 'Bi-Directional ARQ & Half-Duplex Link',
          milestone: 'Milestone 2',
          cratePath: 'crates/sounddrop_transport',
          status: ImplementationStatus.compiledAndTested,
          description: 'Stop-and-Wait ARQ with timeouts, exponential backoff, duplicate packet rejection, and 100ms reverberation decay turn-around.',
        ),
        FeatureAuditEntry(
          title: 'End-to-End Cryptography (X25519, ChaCha20-Poly1305, SAS)',
          milestone: 'Milestone 3',
          cratePath: 'crates/sounddrop_crypto',
          status: ImplementationStatus.compiledAndTested,
          description: 'Ephemeral Curve25519 key exchange, BLAKE3 directional KDF, 6-digit PIN & 4-word mnemonic SAS generator, and replay-protected AEAD.',
        ),
        FeatureAuditEntry(
          title: 'File Chunking, BLAKE3 Integrity Tree & Resumption',
          milestone: 'Milestone 4',
          cratePath: 'crates/sounddrop_file',
          status: ImplementationStatus.compiledAndTested,
          description: 'BLAKE3 file root and chunk hashing, on-disk sparse .part assembly, state file bitmap tracking, and bit-exact reconstruction.',
        ),
        FeatureAuditEntry(
          title: 'Native Mobile Audio Drivers (Android Oboe & iOS CoreAudio)',
          milestone: 'Milestone 5',
          cratePath: 'platform/android, platform/ios, crates/sounddrop_audio_io',
          status: ImplementationStatus.compiledAndTested,
          description: 'Google Oboe low-latency C++ stream bypassing AGC/AEC; iOS AVAudioSessionModeMeasurement with AUHAL RemoteIO.',
        ),
        FeatureAuditEntry(
          title: 'Flutter Native Shell & Honest UI',
          milestone: 'Milestone 6',
          cratePath: 'apps/sounddrop_flutter, crates/sounddrop_ffi',
          status: ImplementationStatus.compiledAndTested,
          description: 'Cross-platform Flutter application wired via C-FFI; real waterfall spectral painter; strict honest feature badges.',
        ),
        FeatureAuditEntry(
          title: 'Hybrid Wi-Fi Transport Handover',
          milestone: 'Milestone 7',
          cratePath: 'crates/sounddrop_hybrid',
          status: ImplementationStatus.compiledAndTested,
          description: 'Acoustic connection bootstrap negotiating local high-speed Wi-Fi / direct socket payload handover with seamless acoustic fallback.',
        ),
        FeatureAuditEntry(
          title: 'Multi-Hop Acoustic Mesh Relay',
          milestone: 'Milestone 8',
          cratePath: 'crates/sounddrop_mesh',
          status: ImplementationStatus.compiledAndTested,
          description: 'Store-and-forward relay stations, deduplication cache, hop counting, and TTL loop suppression for multi-hop acoustic transmission.',
        ),
      ];
}
