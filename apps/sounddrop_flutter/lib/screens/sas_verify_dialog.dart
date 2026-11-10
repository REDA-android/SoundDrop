/// View model and validation for the out-of-band Short Authentication String (SAS) confirmation modal.
class SasVerifyDialogViewModel {
  final String pin;
  final String words;
  final bool isVerified;

  const SasVerifyDialogViewModel({
    required this.pin,
    required this.words,
    this.isVerified = false,
  });

  /// Instruction text presented to the user to thwart active Man-In-The-Middle attacks.
  String get securityNotice =>
      'Compare this 6-digit PIN and 4-word mnemonic with the peer device across an out-of-band channel (visually or verbally). '
      'If both devices display identical codes, the session is cryptographically authenticated with zero interception.';

  List<String> get wordList => words.split(' - ');
}
