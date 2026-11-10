import 'dart:async';
import 'dart:convert';
import '../core/ffi/sounddrop_bindings.dart';
import '../models/transfer_state.dart';

/// Notifier driving the file transfer screen and out-of-band SAS confirmation:
/// - Executes real file transfers via the native Rust file engine
/// - Updates chunk progress and bitrates
/// - Coordinates out-of-band Short Authentication String (SAS) modal
class FileTransferNotifier {
  final SoundDropBindings _bindings;

  TransferState _state = const TransferState();
  final _stateController = StreamController<TransferState>.broadcast();

  FileTransferNotifier([SoundDropBindings? bindings])
      : _bindings = bindings ?? SoundDropBindings();

  TransferState get state => _state;
  Stream<TransferState> get stateStream => _stateController.stream;

  /// Starts an acoustic file transfer through the native Rust engine.
  Future<bool> startFileTransfer({
    required String filePath,
    required String outputDir,
    required String cacheDir,
    int chunkSize = 32,
    double dataLoss = 0.05,
    double ackLoss = 0.05,
    double snrDb = 22.0,
  }) async {
    _updateState(_state.copyWith(
      status: TransferStatus.handshaking,
      fileName: filePath.split(RegExp(r'[/\\]')).last,
      errorMessage: null,
    ));

    try {
      // Execute file transfer via Rust C-FFI
      final jsonResponse = _bindings.runFileTransfer(
        filePath: filePath,
        outputDir: outputDir,
        cacheDir: cacheDir,
        chunkSize: chunkSize,
        dataLoss: dataLoss,
        ackLoss: ackLoss,
        snrDb: snrDb,
      );

      final Map<String, dynamic> data = jsonDecode(jsonResponse) as Map<String, dynamic>;

      if (data['status'] == 'ok') {
        _updateState(_state.copyWith(
          status: TransferStatus.completed,
          fileName: data['fileName'] as String?,
          totalBytes: (data['fileSize'] as num?)?.toInt() ?? 0,
          bytesTransferred: (data['fileSize'] as num?)?.toInt() ?? 0,
          totalChunks: (data['totalChunks'] as num?)?.toInt() ?? 0,
          chunksDelivered: (data['chunksDelivered'] as num?)?.toInt() ?? 0,
          rootHash: data['rootHash'] as String?,
          outputPath: data['outputPath'] as String?,
          sasPin: data['sasPin'] as String?,
          sasWords: data['sasWords'] as String?,
          sasVerified: data['sasVerified'] as bool? ?? false,
          effectiveBps: (data['effectiveBps'] as num?)?.toDouble() ?? 0.0,
        ));
        return true;
      } else {
        final err = data['message'] as String? ?? 'Unknown error';
        _updateState(_state.copyWith(
          status: TransferStatus.failed,
          errorMessage: err,
        ));
        return false;
      }
    } catch (e) {
      _updateState(_state.copyWith(
        status: TransferStatus.failed,
        errorMessage: e.toString(),
      ));
      return false;
    }
  }

  void confirmSas() {
    _updateState(_state.copyWith(sasVerified: true));
  }

  void reset() {
    _updateState(const TransferState());
  }

  void _updateState(TransferState newState) {
    _state = newState;
    _stateController.add(_state);
  }

  void dispose() {
    _stateController.close();
  }
}
