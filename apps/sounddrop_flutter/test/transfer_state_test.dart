import 'package:sounddrop_flutter/models/transfer_state.dart';
import 'package:test/test.dart';

void main() {
  group('TransferState Tests', () {
    test('Default TransferState is idle with zero progress', () {
      const state = TransferState();
      expect(state.status, equals(TransferStatus.idle));
      expect(state.progress, equals(0.0));
      expect(state.sasVerified, isFalse);
    });

    test('TransferState progress reflects chunk delivery fraction', () {
      const state = TransferState(
        status: TransferStatus.transferring,
        totalChunks: 10,
        chunksDelivered: 4,
      );
      expect(state.progress, closeTo(0.4, 0.001));
    });

    test('TransferState copyWith transitions accurately', () {
      const initial = TransferState(fileName: 'audio.wav');
      final updated = initial.copyWith(
        status: TransferStatus.completed,
        totalChunks: 5,
        chunksDelivered: 5,
        sasVerified: true,
      );

      expect(updated.fileName, equals('audio.wav'));
      expect(updated.status, equals(TransferStatus.completed));
      expect(updated.progress, equals(1.0));
      expect(updated.sasVerified, isTrue);
    });
  });
}
