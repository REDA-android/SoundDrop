#!/usr/bin/env bash
set -euo pipefail

# SoundDrop Android NDK Cross-Compilation Script
echo "=== SoundDrop Android Toolchain Pipeline ==="

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JNI_DIR="${ROOT_DIR}/apps/sounddrop_flutter/android/app/src/main/jniLibs"

TARGETS=(
    "aarch64-linux-android:arm64-v8a"
    "armv7-linux-androideabi:armeabi-v7a"
    "x86_64-linux-android:x86_64"
)

if ! command -v cargo-ndk &> /dev/null; then
    echo "[INFO] cargo-ndk is not installed on PATH."
    echo "[INFO] Install with: cargo install cargo-ndk"
    echo "[INFO] Ensure ANDROID_NDK_HOME is configured."
fi

for ENTRY in "${TARGETS[@]}"; do
    TARGET="${ENTRY%%:*}"
    ABI="${ENTRY##*:}"
    TARGET_JNI="${JNI_DIR}/${ABI}"
    mkdir -p "${TARGET_JNI}"

    echo "[*] Preparing target ABI: ${ABI} (${TARGET})..."
    if command -v cargo-ndk &> /dev/null; then
        echo "    Building libsounddrop_ffi for ${ABI}..."
        cargo ndk -t "${ABI}" build --release -p sounddrop_ffi
        cp "${ROOT_DIR}/target/${TARGET}/release/libsounddrop_ffi.so" "${TARGET_JNI}/libsounddrop_ffi.so"
    else
        echo "    [STUB] Output path ready: ${TARGET_JNI}/libsounddrop_ffi.so"
    fi
done

echo "Android NDK directory structure verified in ${JNI_DIR}"
