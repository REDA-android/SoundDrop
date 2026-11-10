#!/usr/bin/env bash
set -euo pipefail

# SoundDrop Desktop Build & Package Script (Linux / macOS / Windows)
echo "=== SoundDrop Desktop Build Pipeline ==="

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist/desktop"

mkdir -p "${DIST_DIR}/bin" "${DIST_DIR}/lib"

echo "[1/3] Building Rust core release binaries..."
cargo build --release --workspace

echo "[2/3] Collecting artifacts..."
if [[ "$OSTYPE" == "linux"* ]]; then
    cp "${ROOT_DIR}/target/release/sounddrop" "${DIST_DIR}/bin/sounddrop"
    cp "${ROOT_DIR}/target/release/libsounddrop_ffi.so" "${DIST_DIR}/lib/libsounddrop_ffi.so"
    strip "${DIST_DIR}/bin/sounddrop" || true
elif [[ "$OSTYPE" == "darwin"* ]]; then
    cp "${ROOT_DIR}/target/release/sounddrop" "${DIST_DIR}/bin/sounddrop"
    cp "${ROOT_DIR}/target/release/libsounddrop_ffi.dylib" "${DIST_DIR}/lib/libsounddrop_ffi.dylib"
elif [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "win32"* ]]; then
    cp "${ROOT_DIR}/target/release/sounddrop.exe" "${DIST_DIR}/bin/sounddrop.exe"
    cp "${ROOT_DIR}/target/release/sounddrop_ffi.dll" "${DIST_DIR}/lib/sounddrop_ffi.dll"
fi

echo "[3/3] Creating release manifest..."
cat <<EOF > "${DIST_DIR}/VERSION.txt"
SoundDrop Native Desktop Release
Version: 0.1.0-sounddrop-native
Commit: $(git rev-parse --short HEAD 2>/dev/null || echo "release")
Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Platforms Supported: Linux x86_64, macOS arm64/x86_64, Windows x64
EOF

echo "Desktop release bundle ready in ${DIST_DIR}"
