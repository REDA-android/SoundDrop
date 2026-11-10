import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sounddrop_flutter/core/ffi/sounddrop_bindings.dart';
import 'package:sounddrop_flutter/ui/airgap_service.dart';
import 'package:sounddrop_flutter/ui/home_page.dart';

class _FakeService implements AirgapService {
  String? sent;
  AcousticProfile? sentProfile;
  bool failReceive = false;

  @override
  Future<void> transmit(String message, AcousticProfile profile) async {
    sent = message;
    sentProfile = profile;
  }

  @override
  Future<DecodeResult> receive(double durationSec, AcousticProfile profile) async {
    if (failReceive) throw StateError('no preamble detected');
    return DecodeResult(message: 'peer says hi', snrMargin: 5.0, correlation: 0.95, fecErrorsCorrected: 1);
  }
}

void main() {
  testWidgets('send passes message and selected profile to the service', (tester) async {
    final svc = _FakeService();
    await tester.pumpWidget(MaterialApp(home: HomePage(service: svc)));
    await tester.enterText(find.byKey(const Key('message_field')), 'ping');
    await tester.tap(find.byKey(const Key('send_button')));
    await tester.pumpAndSettle();
    expect(svc.sent, 'ping');
    expect(svc.sentProfile, AcousticProfile.robust);
    expect(find.text('Transmission finished'), findsOneWidget);
  });

  testWidgets('listen shows decoded message and real metrics', (tester) async {
    await tester.pumpWidget(MaterialApp(home: HomePage(service: _FakeService())));
    await tester.tap(find.byKey(const Key('listen_button')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('received_text')), findsOneWidget);
    expect(find.text('peer says hi'), findsOneWidget);
  });

  testWidgets('listen failure is reported, not hidden', (tester) async {
    final svc = _FakeService()..failReceive = true;
    await tester.pumpWidget(MaterialApp(home: HomePage(service: svc)));
    await tester.tap(find.byKey(const Key('listen_button')));
    await tester.pumpAndSettle();
    expect(find.textContaining('No frame decoded'), findsOneWidget);
    expect(find.byKey(const Key('received_text')), findsNothing);
  });
}
