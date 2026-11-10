# SoundDrop

Offline, serverless data transfer over sound (16-FSK + chirp sync, Reed-Solomon FEC,
Stop-and-Wait ARQ, X25519 + ChaCha20-Poly1305 E2E encryption with SAS verification,
BLAKE3 file integrity, optional Wi-Fi handover, multi-hop relay).

## Verification status (read this first)

| Area | Compiled | Automated tests | Verified on real audio hardware |
|---|---|---|---|
| PHY (modem, FEC, sync) | yes | yes (synthetic noise/echo, WAV round-trip) | **no** |
| ARQ / transport | yes | yes (simulated lossy channel) | **no** |
| Crypto / SAS | yes | yes | n/a |
| File transfer + BLAKE3 | yes | yes (simulated channel) | **no** |
| Hybrid Wi-Fi handover | yes | yes (loopback TCP on one host) | **no** (two devices) |
| Mesh relay | yes | yes (in-process simulation) | **no** |
| Android (Oboe) / iOS (CoreAudio) drivers | not built in CI | no | **no** |
| Flutter app | analyzed + unit tests | yes | **no** |

"Automated tests" use synthetic channels. They show internal consistency,
not acoustic performance. Real range, error rate and clock-drift accuracy are unmeasured.

## Try it between two real machines

```bash
cargo build --release -p sounddrop_cli
./target/release/sounddrop devices
# machine B
./target/release/sounddrop rx -d 10        # add --fast on both sides for 20 ms symbols
# machine A
./target/release/sounddrop tx -m "hello"
```

Both sides must use the same profile (`--ultrasonic` / `--fast` / default).
Without a sound card, `tx -w out.wav` and `rx -w out.wav` exercise the codec through a file.

## Tests

```bash
cargo test --release --workspace
./scripts/run_airgap_suite.sh
```