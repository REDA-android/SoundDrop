#!/usr/bin/env bash
set -euo pipefail

# SoundDrop Comprehensive Acoustic Air-Gap Hardware Regression Suite
echo "=========================================================="
echo ">>> SoundDrop End-to-End System Regression Suite <<<"
echo "=========================================================="

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${ROOT_DIR}/target/release/sounddrop"
TMP_DIR="$(mktemp -d -t sounddrop_suite_XXXXXX)"

cleanup() {
    rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "[Build] Ensuring release binary is compiled..."
cargo build --release -p sounddrop_cli

echo ""
echo "[Step 1/6] Physical Layer Benchmark (Matched Filter & Chirp Correlation)..."
"${BIN}" bench --message "PHYSICAL_LAYER_TEST" --snr-db 15.0 --click-noise

echo ""
echo "[Step 2/6] ARQ Data Link Verification (Half-Duplex Turnaround)..."
"${BIN}" send-arq --message "SoundDrop ARQ Reliable Link Verified" --data-loss 0.10 --ack-loss 0.05 --snr-db 18.0

echo ""
echo "[Step 3/6] End-to-End Cryptography (X25519 + ChaCha20-Poly1305 + SAS)..."
"${BIN}" send-secure --message "Encrypted Acoustic Communication Pass" --data-loss 0.05 --snr-db 20.0

echo ""
echo "[Step 4/6] File Transfer & BLAKE3 Root Hash Audit..."
SAMPLE_FILE="${TMP_DIR}/test_doc.txt"
echo "SoundDrop Milestone 4: High-resilience sparse chunk assembly audit." > "${SAMPLE_FILE}"
"${BIN}" send-file --file "${SAMPLE_FILE}" --out-dir "${TMP_DIR}/file_rx" --chunk-size 32

echo ""
echo "[Step 5/6] Hybrid Transport Handover & Acoustic Fallback..."
"${BIN}" send-hybrid --file "${SAMPLE_FILE}" --out-dir "${TMP_DIR}/hybrid_wifi"
"${BIN}" send-hybrid --file "${SAMPLE_FILE}" --out-dir "${TMP_DIR}/hybrid_fallback" --block-wifi

echo ""
echo "[Step 6/6] Multi-Hop Mesh Relay Routing & Storm Suppression..."
"${BIN}" send-mesh --message "Acoustic Relay A->R->B Verified!" --topology linear
"${BIN}" send-mesh --message "Acoustic Relay A->R->B Verified!" --topology diamond

echo ""
echo "=========================================================="
echo ">>> ALL 6 SUBSYSTEMS VERIFIED & OPERATIONAL (100% PASS) <<<"
echo "=========================================================="
