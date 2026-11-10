enum TransferStatus {
  idle,
  handshaking,
  sasVerifying,
  transferring,
  completed,
  failed,
}

/// Represents the active state of an acoustic message or file transfer.
class TransferState {
  final TransferStatus status;
  final String? fileName;
  final int totalBytes;
  final int bytesTransferred;
  final int totalChunks;
  final int chunksDelivered;
  final String? rootHash;
  final String? outputPath;
  final String? sasPin;
  final String? sasWords;
  final bool sasVerified;
  final double effectiveBps;
  final String? errorMessage;

  const TransferState({
    this.status = TransferStatus.idle,
    this.fileName,
    this.totalBytes = 0,
    this.bytesTransferred = 0,
    this.totalChunks = 0,
    this.chunksDelivered = 0,
    this.rootHash,
    this.outputPath,
    this.sasPin,
    this.sasWords,
    this.sasVerified = false,
    this.effectiveBps = 0.0,
    this.errorMessage,
  });

  double get progress {
    if (totalChunks == 0) return 0.0;
    return (chunksDelivered / totalChunks).clamp(0.0, 1.0);
  }

  TransferState copyWith({
    TransferStatus? status,
    String? fileName,
    int? totalBytes,
    int? bytesTransferred,
    int? totalChunks,
    int? chunksDelivered,
    String? rootHash,
    String? outputPath,
    String? sasPin,
    String? sasWords,
    bool? sasVerified,
    double? effectiveBps,
    String? errorMessage,
  }) {
    return TransferState(
      status: status ?? this.status,
      fileName: fileName ?? this.fileName,
      totalBytes: totalBytes ?? this.totalBytes,
      bytesTransferred: bytesTransferred ?? this.bytesTransferred,
      totalChunks: totalChunks ?? this.totalChunks,
      chunksDelivered: chunksDelivered ?? this.chunksDelivered,
      rootHash: rootHash ?? this.rootHash,
      outputPath: outputPath ?? this.outputPath,
      sasPin: sasPin ?? this.sasPin,
      sasWords: sasWords ?? this.sasWords,
      sasVerified: sasVerified ?? this.sasVerified,
      effectiveBps: effectiveBps ?? this.effectiveBps,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}
