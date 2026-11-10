/// Dart representation of a SoundDrop FileManifest wire format.
class FileManifestModel {
  final String fileId;
  final String fileName;
  final int fileSize;
  final int chunkSize;
  final int totalChunks;
  final String rootHash;

  const FileManifestModel({
    required this.fileId,
    required this.fileName,
    required this.fileSize,
    required this.chunkSize,
    required this.totalChunks,
    required this.rootHash,
  });

  factory FileManifestModel.fromJson(Map<String, dynamic> json) {
    return FileManifestModel(
      fileId: json['fileId'] as String? ?? '',
      fileName: json['fileName'] as String? ?? 'unknown',
      fileSize: (json['fileSize'] as num?)?.toInt() ?? 0,
      chunkSize: (json['chunkSize'] as num?)?.toInt() ?? 32,
      totalChunks: (json['totalChunks'] as num?)?.toInt() ?? 0,
      rootHash: json['rootHash'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'fileId': fileId,
        'fileName': fileName,
        'fileSize': fileSize,
        'chunkSize': chunkSize,
        'totalChunks': totalChunks,
        'rootHash': rootHash,
      };
}
