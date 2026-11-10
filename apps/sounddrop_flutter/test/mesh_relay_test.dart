import 'package:sounddrop_flutter/core/ffi/sounddrop_bindings.dart';
import 'package:sounddrop_flutter/screens/mesh_relay_screen.dart';
import 'package:test/test.dart';

void main() {
  group('MeshRelayScreenController Tests', () {
    late SoundDropBindings bindings;
    late MeshRelayScreenController controller;

    setUpAll(() {
      bindings = SoundDropBindings();
      controller = MeshRelayScreenController(bindings);
    });

    test('Initial relay station state is standby with zero statistics', () {
      final vm = controller.viewModel;
      expect(vm.isRelayActive, isFalse);
      expect(vm.nodeIdHex, equals('0x0002'));
      expect(vm.packetsRelayed, equals(0));
      expect(vm.duplicatesSuppressed, equals(0));
      expect(vm.deliveredCount, equals(0));
      expect(vm.statusText, contains('STANDBY'));
    });

    test('Toggle relay active state transitions to ACTIVE', () {
      controller.toggleRelayActive();
      expect(controller.viewModel.isRelayActive, isTrue);
      expect(controller.viewModel.statusText, contains('ACTIVE'));

      controller.toggleRelayActive();
      expect(controller.viewModel.isRelayActive, isFalse);
    });

    test('Set custom node ID updates hex display', () {
      controller.setNodeId(0x10AF);
      expect(controller.viewModel.nodeIdHex, equals('0x10AF'));
      controller.setNodeId(0x0002); // reset
    });

    test('Test relay execution increments relay and delivery statistics', () {
      final initialRelayed = controller.viewModel.packetsRelayed;
      final result = controller.runTestRelay(
        srcId: 0x0001,
        dstId: 0x0003,
        message: 'Flutter Relay Screen Verification',
      );

      expect(result, contains('"status":"ok"'));
      expect(result, contains('"verified":true'));
      expect(controller.viewModel.packetsRelayed, equals(initialRelayed + 1));
      expect(controller.viewModel.deliveredCount, greaterThan(0));
    });

    test('Test diamond relay execution increments duplicate suppression statistic', () {
      final initialSuppressed = controller.viewModel.duplicatesSuppressed;
      final result = controller.runTestDiamondRelay(
        srcId: 0x0001,
        r2Id: 0x0003,
        dstId: 0x0004,
        message: 'Diamond Duplication Check',
      );

      expect(result, contains('"status":"ok"'));
      expect(result, contains('"verified":true'));
      expect(controller.viewModel.duplicatesSuppressed, equals(initialSuppressed + 1));
    });
  });
}
