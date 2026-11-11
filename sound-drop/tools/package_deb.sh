#!/usr/bin/env bash
set -euo pipefail

# Sound Drop v2 - Debian Package Builder (.deb)
# Packages the optimized native Slint GPU binary with desktop integration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WORKSPACE_ROOT}/.." && pwd)"

VERSION="0.2.0"
ARCH="amd64"
PKG_NAME="sounddrop_${VERSION}_${ARCH}"
BUILD_DIR="${WORKSPACE_ROOT}/target/deb_build/${PKG_NAME}"
RELEASE_BIN="${WORKSPACE_ROOT}/target/release/sounddrop-app"

echo "=== Packaging Sound Drop v2 Debian Package (${PKG_NAME}.deb) ==="

# 1. Verify release binary exists (or build it)
if [[ ! -f "${RELEASE_BIN}" ]]; then
  echo "[1/4] Release binary not found. Building with cargo build --release..."
  cargo build --release --workspace --manifest-path "${WORKSPACE_ROOT}/Cargo.toml"
fi

# 2. Prepare Debian filesystem hierarchy
echo "[2/4] Setting up Debian package structure..."
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}/DEBIAN"
mkdir -p "${BUILD_DIR}/usr/local/bin"
mkdir -p "${BUILD_DIR}/usr/share/applications"
mkdir -p "${BUILD_DIR}/usr/share/icons/hicolor/512x512/apps"

# 3. Copy binary and assets
echo "[3/4] Copying binary, desktop entry and icon..."
cp "${RELEASE_BIN}" "${BUILD_DIR}/usr/local/bin/sounddrop-app"
chmod 755 "${BUILD_DIR}/usr/local/bin/sounddrop-app"

# Desktop entry
cat << 'EOF' > "${BUILD_DIR}/usr/share/applications/sounddrop.desktop"
[Desktop Entry]
Name=Sound Drop
Comment=Air-gapped acoustic data transfer using sound waves and Slint GPU UI
Exec=/usr/local/bin/sounddrop-app
Icon=sounddrop
Terminal=false
Type=Application
Categories=Utility;AudioVideo;Network;
StartupNotify=true
EOF
chmod 644 "${BUILD_DIR}/usr/share/applications/sounddrop.desktop"

# Icon from public/icon-512.png
if [[ -f "${REPO_ROOT}/public/icon-512.png" ]]; then
  cp "${REPO_ROOT}/public/icon-512.png" "${BUILD_DIR}/usr/share/icons/hicolor/512x512/apps/sounddrop.png"
fi

# Control file
cat << EOF > "${BUILD_DIR}/DEBIAN/control"
Package: sounddrop
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: Reda <contact@sounddrop.org>
Depends: libasound2, libfontconfig1, libx11-6
Description: Sound Drop - Air-gapped acoustic data transfer
 High-performance data transfer across air-gapped devices using sound
 waves (audible and ultrasonic MFSK) with hardware GPU UI via Slint,
 End-to-End Encryption (ChaCha20-Poly1305), and SAS verification.
EOF
chmod 755 "${BUILD_DIR}/DEBIAN"
chmod 644 "${BUILD_DIR}/DEBIAN/control"

# 4. Build .deb package
echo "[4/4] Building .deb archive with dpkg-deb..."
OUTPUT_DIR="${WORKSPACE_ROOT}/dist"
mkdir -p "${OUTPUT_DIR}"
dpkg-deb --build "${BUILD_DIR}" "${OUTPUT_DIR}/${PKG_NAME}.deb"

echo ""
echo "=========================================================="
echo "✓ PAQUET DEBIAN CRÉÉ AVEC SUCCÈS :"
echo "  ${OUTPUT_DIR}/${PKG_NAME}.deb"
ls -lh "${OUTPUT_DIR}/${PKG_NAME}.deb"
echo "=========================================================="
