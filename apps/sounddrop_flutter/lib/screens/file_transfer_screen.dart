import '../models/transfer_state.dart';
import '../providers/file_transfer_notifier.dart';
import '../widgets/honest_badge.dart';

/// Controller and state manager for the file transfer screen.
class FileTransferScreenController {
  final FileTransferNotifier fileNotifier;

  FileTransferScreenController(this.fileNotifier);

  HonestFeatureBadge get badge => const HonestFeatureBadge(
        label: 'BLAKE3 Chunking & ARQ Acoustic Transfer',
        status: ImplementationStatus.compiledAndTested,
      );

  TransferState get state => fileNotifier.state;

  Future<bool> initiateTransfer({
    required String filePath,
    required String outputDir,
    required String cacheDir,
    int chunkSize = 32,
    double dataLoss = 0.05,
    double ackLoss = 0.05,
    double snrDb = 22.0,
  }) {
    return fileNotifier.startFileTransfer(
      filePath: filePath,
      outputDir: outputDir,
      cacheDir: cacheDir,
      chunkSize: chunkSize,
      dataLoss: dataLoss,
      ackLoss: ackLoss,
      snrDb: snrDb,
    );
  }

  void confirmSas() {
    fileNotifier.confirmSas();
  }

  void reset() {
    fileNotifier.reset();
  }
}
