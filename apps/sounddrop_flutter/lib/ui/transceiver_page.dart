import 'package:flutter/material.dart';

import '../core/ffi/sounddrop_bindings.dart';
import '../models/link_metrics.dart';
import '../widgets/audio_level_meter.dart';
import 'airgap_service.dart';

/// Real speaker/microphone transceiver. Nothing here is simulated: transmit plays audio
/// through the speaker, receive records from the microphone and decodes one frame.
class TransceiverPage extends StatefulWidget {
  final AirgapService service;

  const TransceiverPage({super.key, this.service = const NativeAirgapService()});

  @override
  State<TransceiverPage> createState() => _TransceiverPageState();
}

class _TransceiverPageState extends State<TransceiverPage> {
  final _text = TextEditingController(text: 'Hello from SoundDrop');
  AcousticProfile _profile = AcousticProfile.robust;
  double _listenSeconds = 8;
  bool _busy = false;
  String _status = 'Idle';
  String? _received;
  LinkMetrics? _metrics;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final msg = _text.text;
    if (msg.trim().isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _status = 'Playing through speaker...';
    });
    try {
      await widget.service.transmit(msg, _profile);
      if (!mounted) return;
      setState(() => _status = 'Transmission finished');
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'Transmit failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _listen() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _status = 'Recording from microphone for ${_listenSeconds.toStringAsFixed(0)} s...';
      _received = null;
    });
    try {
      final r = await widget.service.receive(_listenSeconds, _profile);
      if (!mounted) return;
      setState(() {
        _received = r.message;
        _metrics = LinkMetrics(
          snrMargin: r.snrMargin,
          correlation: r.correlation,
          fecErrorsCorrected: r.fecErrorsCorrected,
        );
        _status = 'Frame received and CRC verified';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'No frame decoded: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = _metrics;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        TextField(
          key: const Key('message_field'),
          controller: _text,
          maxLength: 48,
          decoration: const InputDecoration(labelText: 'Message', border: OutlineInputBorder()),
        ),
        DropdownButtonFormField<AcousticProfile>(
          key: const Key('profile_dropdown'),
          initialValue: _profile,
          decoration: const InputDecoration(labelText: 'Profile (must match on both devices)'),
          items: [
            for (final p in AcousticProfile.values) DropdownMenuItem(value: p, child: Text(p.label)),
          ],
          onChanged: _busy ? null : (p) => setState(() => _profile = p!),
        ),
        const SizedBox(height: 8),
        Text('Listen duration: ${_listenSeconds.toStringAsFixed(0)} s'),
        Slider(
          min: 3,
          max: 30,
          divisions: 27,
          value: _listenSeconds,
          onChanged: _busy ? null : (v) => setState(() => _listenSeconds = v),
        ),
        Row(children: [
          Expanded(
            child: FilledButton.icon(
              key: const Key('send_button'),
              onPressed: _busy ? null : _send,
              icon: const Icon(Icons.volume_up),
              label: const Text('Send (speaker)'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FilledButton.tonalIcon(
              key: const Key('listen_button'),
              onPressed: _busy ? null : _listen,
              icon: const Icon(Icons.mic),
              label: const Text('Listen (mic)'),
            ),
          ),
        ]),
        const SizedBox(height: 12),
        if (_busy) const LinearProgressIndicator(),
        Text(_status, key: const Key('status_text')),
        if (_received != null) ...[
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              title: Text(_received!, key: const Key('received_text')),
              subtitle: m == null
                  ? null
                  : Text('SNR margin ${LinkQualityViewModel(m).snrFormatted} · '
                      'sync ${LinkQualityViewModel(m).correlationFormatted} · '
                      'FEC fixes ${LinkQualityViewModel(m).fecFormatted} · '
                      '${LinkQualityViewModel(m).gradeLabel}'),
            ),
          ),
        ],
      ],
    );
  }
}
