import 'core/ffi/sounddrop_bindings.dart';
import 'providers/acoustic_session_notifier.dart';
import 'providers/file_transfer_notifier.dart';
import 'screens/file_transfer_screen.dart';
import 'screens/mesh_relay_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/transceiver_screen.dart';

/// SoundDrop Flutter Application Controller.
class SoundDropApp {
  final SoundDropBindings bindings;
  late final AcousticSessionNotifier sessionNotifier;
  late final FileTransferNotifier fileNotifier;

  late final TransceiverScreenController transceiverController;
  late final FileTransferScreenController fileTransferController;
  late final MeshRelayScreenController meshRelayController;
  late final SettingsScreenController settingsController;

  SoundDropApp([SoundDropBindings? customBindings])
      : bindings = customBindings ?? SoundDropBindings() {
    sessionNotifier = AcousticSessionNotifier(bindings);
    fileNotifier = FileTransferNotifier(bindings);

    transceiverController = TransceiverScreenController(sessionNotifier);
    fileTransferController = FileTransferScreenController(fileNotifier);
    meshRelayController = MeshRelayScreenController(bindings);
    settingsController = SettingsScreenController();
  }

  String get coreVersion => bindings.getVersion();

  void dispose() {
    sessionNotifier.dispose();
    fileNotifier.dispose();
  }
}
