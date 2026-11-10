import 'core/ffi/sounddrop_bindings.dart';
import 'providers/acoustic_session_notifier.dart';
import 'providers/file_transfer_notifier.dart';
import 'screens/file_transfer_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/transceiver_screen.dart';

/// SoundDrop Flutter Application Controller.
class SoundDropApp {
  final SoundDropBindings bindings;
  late final AcousticSessionNotifier sessionNotifier;
  late final FileTransferNotifier fileNotifier;

  late final TransceiverScreenController transceiverController;
  late final FileTransferScreenController fileTransferController;
  late final SettingsScreenController settingsController;

  SoundDropApp([SoundDropBindings? customBindings])
      : bindings = customBindings ?? SoundDropBindings() {
    sessionNotifier = AcousticSessionNotifier(bindings);
    fileNotifier = FileTransferNotifier(bindings);

    transceiverController = TransceiverScreenController(sessionNotifier);
    fileTransferController = FileTransferScreenController(fileNotifier);
    settingsController = SettingsScreenController();
  }

  String get coreVersion => bindings.getVersion();

  void dispose() {
    sessionNotifier.dispose();
    fileNotifier.dispose();
  }
}

void main() {
  final app = SoundDropApp();
  // ignore: avoid_print
  print('========================================================');
  // ignore: avoid_print
  print('SoundDrop Native Flutter Application Initialized');
  // ignore: avoid_print
  print('Native Core Engine Version: ${app.coreVersion}');
  // ignore: avoid_print
  print('Acoustic PHY Status:        ${app.transceiverController.badge.displayText}');
  // ignore: avoid_print
  print('File Transfer Status:       ${app.fileTransferController.badge.displayText}');
  // ignore: avoid_print
  print('========================================================');
}
