import 'package:flutter/material.dart';

import 'airgap_service.dart';
import 'transceiver_page.dart';

class HomePage extends StatefulWidget {
  final AirgapService service;
  const HomePage({super.key, this.service = const NativeAirgapService()});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [TransceiverPage(service: widget.service), const _StatusPage()];
    return Scaffold(
      appBar: AppBar(title: const Text('SoundDrop')),
      body: SafeArea(child: pages[_index]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.graphic_eq), label: 'Transceiver'),
          NavigationDestination(icon: Icon(Icons.verified_outlined), label: 'Status'),
        ],
      ),
    );
  }
}

class _StatusPage extends StatelessWidget {
  const _StatusPage();

  @override
  Widget build(BuildContext context) {
    const rows = [
      ('Acoustic send/receive (speaker, microphone)', 'Wired to native core. Not yet verified on real devices.'),
      ('Encryption, file transfer, Wi-Fi handover, mesh relay', 'Implemented and tested in the Rust core. Not exposed in this UI yet.'),
      ('Android / iOS audio drivers', 'Source present. Not built or tested in this project yet.'),
    ];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (final r in rows)
          Card(child: ListTile(title: Text(r.$1), subtitle: Text(r.$2))),
      ],
    );
  }
}
