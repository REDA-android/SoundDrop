import 'package:flutter/material.dart';

import 'ui/home_page.dart';

void main() {
  runApp(const SoundDropFlutterApp());
}

class SoundDropFlutterApp extends StatelessWidget {
  const SoundDropFlutterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SoundDrop',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const HomePage(),
    );
  }
}
