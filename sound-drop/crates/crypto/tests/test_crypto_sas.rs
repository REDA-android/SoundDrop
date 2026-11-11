use sounddrop_crypto::{
    compute_sas, decrypt_frame, derive_broadcast_key, derive_session_key, encrypt_frame,
    EphemeralKeyPair,
};

/// Phase 3 Acceptance Criteria:
/// "Crypto + SAS: Un tiers injectant sa clé produit un SAS différent"
#[test]
fn test_phase3_sas_mitm_detection() {
    let session_id = 0x42A1;

    // Honest peers A and B
    let alice = EphemeralKeyPair::generate();
    let bob = EphemeralKeyPair::generate();

    // Adversary Mallory
    let mallory = EphemeralKeyPair::generate();

    // Legitimate handshake between Alice and Bob
    let sas_alice_legit = compute_sas(&alice.public_bytes(), &bob.public_bytes(), session_id);
    let sas_bob_legit = compute_sas(&bob.public_bytes(), &alice.public_bytes(), session_id);

    // Legitimate peers MUST have identical SAS
    assert_eq!(
        sas_alice_legit, sas_bob_legit,
        "Legitimate handshake must yield identical SAS"
    );
    assert_eq!(sas_alice_legit.len(), 6);

    // Mallory performs MITM by injecting her public key
    let sas_alice_with_mallory = compute_sas(&alice.public_bytes(), &mallory.public_bytes(), session_id);
    let sas_bob_with_mallory = compute_sas(&bob.public_bytes(), &mallory.public_bytes(), session_id);

    println!("[Phase 3] Legitimate SAS: {}", sas_alice_legit);
    println!("[Phase 3] Alice-Mallory SAS: {}", sas_alice_with_mallory);
    println!("[Phase 3] Bob-Mallory SAS: {}", sas_bob_with_mallory);

    // MUST DETECT MITM: SAS with attacker must differ from legitimate SAS
    assert_ne!(
        sas_alice_legit, sas_alice_with_mallory,
        "MITM detected: Alice SAS must differ when Mallory injects her key"
    );
    assert_ne!(
        sas_bob_legit, sas_bob_with_mallory,
        "MITM detected: Bob SAS must differ when Mallory injects her key"
    );
    assert_ne!(
        sas_alice_with_mallory, sas_bob_with_mallory,
        "Mallory cannot produce matching SAS for both parties"
    );
}

#[test]
fn test_phase3_aead_encryption_and_integrity() {
    let session_id = 0x8899;
    let alice = EphemeralKeyPair::generate();
    let bob = EphemeralKeyPair::generate();

    let shared_alice = alice.diffie_hellman(&bob.public_bytes());
    let shared_bob = bob.diffie_hellman(&alice.public_bytes());
    assert_eq!(shared_alice, shared_bob);

    let key_alice = derive_session_key(&shared_alice, None, session_id);
    let key_bob = derive_session_key(&shared_bob, None, session_id);
    assert_eq!(key_alice, key_bob);

    let frame_counter = 1u64;
    let header_aad = b"HDR_SEQ_0001";
    let plaintext = b"Confidential air-gapped payload transmission";

    // Alice encrypts
    let ciphertext = encrypt_frame(&key_alice, frame_counter, header_aad, plaintext)
        .expect("encryption failed");

    // Bob decrypts
    let decrypted = decrypt_frame(&key_bob, frame_counter, header_aad, &ciphertext)
        .expect("decryption failed");
    assert_eq!(&decrypted[..], plaintext);

    // Tampered ciphertext MUST fail authentication
    let mut tampered = ciphertext.clone();
    tampered[0] ^= 0xFF;
    assert!(decrypt_frame(&key_bob, frame_counter, header_aad, &tampered).is_err());

    // Tampered AAD (e.g. frame counter spoofing) MUST fail authentication
    let tampered_aad = b"HDR_SEQ_0002";
    assert!(decrypt_frame(&key_bob, frame_counter, tampered_aad, &ciphertext).is_err());
}

#[test]
fn test_phase3_argon2_broadcast_mode() {
    let passphrase = "airgap-shared-diode-secret-key-2026";
    let salt = b"sounddrop-salt42";

    let key1 = derive_broadcast_key(passphrase, salt).expect("argon2 failed");
    let key2 = derive_broadcast_key(passphrase, salt).expect("argon2 failed");
    assert_eq!(key1, key2);

    let wrong_key = derive_broadcast_key("wrong-passphrase", salt).expect("argon2 failed");
    assert_ne!(key1, wrong_key);
}
