import '../core/ffi/sounddrop_bindings.dart';
import '../widgets/honest_badge.dart';

class MeshRelayViewModel {
  final int nodeId;
  final bool isRelayActive;
  final int packetsRelayed;
  final int duplicatesSuppressed;
  final int deliveredCount;
  final String statusText;

  const MeshRelayViewModel({
    required this.nodeId,
    required this.isRelayActive,
    required this.packetsRelayed,
    required this.duplicatesSuppressed,
    required this.deliveredCount,
    required this.statusText,
  });

  String get nodeIdHex => '0x${nodeId.toRadixString(16).padLeft(4, '0').toUpperCase()}';
}

/// Controller managing the Mesh Relay Station view state and interactions.
class MeshRelayScreenController {
  final SoundDropBindings bindings;

  final HonestFeatureBadge badge = const HonestFeatureBadge(
    label: 'Acoustic Mesh Relay',
    status: ImplementationStatus.compiledAndTested,
  );

  int _nodeId = 0x0002;
  bool _isRelayActive = false;
  int _packetsRelayed = 0;
  int _duplicatesSuppressed = 0;
  int _deliveredCount = 0;

  MeshRelayScreenController(this.bindings);

  MeshRelayViewModel get viewModel => MeshRelayViewModel(
        nodeId: _nodeId,
        isRelayActive: _isRelayActive,
        packetsRelayed: _packetsRelayed,
        duplicatesSuppressed: _duplicatesSuppressed,
        deliveredCount: _deliveredCount,
        statusText: _isRelayActive
            ? 'RELAY STATION ACTIVE (Store & Forward Ready)'
            : 'RELAY STANDBY (Offline)',
      );

  void setNodeId(int newId) {
    _nodeId = newId;
  }

  void toggleRelayActive() {
    _isRelayActive = !_isRelayActive;
  }

  /// Triggers a test relay verification through FFI bindings.
  String runTestRelay({
    required int srcId,
    required int dstId,
    required String message,
  }) {
    final result = bindings.runMeshRelay(
      srcId: srcId,
      relayId: _nodeId,
      dstId: dstId,
      message: message,
    );

    if (result.contains('"verified":true')) {
      _packetsRelayed += 1;
      _deliveredCount += 1;
    }
    return result;
  }

  /// Triggers a test diamond deduplication relay through FFI bindings.
  String runTestDiamondRelay({
    required int srcId,
    required int r2Id,
    required int dstId,
    required String message,
  }) {
    final result = bindings.runDiamondRelay(
      srcId: srcId,
      r1Id: _nodeId,
      r2Id: r2Id,
      dstId: dstId,
      message: message,
    );

    if (result.contains('"verified":true')) {
      _duplicatesSuppressed += 1;
      _deliveredCount += 1;
    }
    return result;
  }
}
