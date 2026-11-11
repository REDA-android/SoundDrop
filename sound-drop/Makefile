# Sound Drop v2 - Makefile
# Air-Gapped Acoustic Data Transfer System

SHELL := /bin/bash
LD_LIB := LD_LIBRARY_PATH=/home/antigravity/.local/usr/lib/x86_64-linux-gnu:$$LD_LIBRARY_PATH
XVFB := xvfb-run -a -s "-screen 0 1024x768x24"

.PHONY: all build test phase0 phase1 phase2 phase3 phase4 phase5 phase6 tools run clean

all: build test

build:
	@echo "=== Building Sound Drop v2 Workspace ==="
	cargo build --workspace

phase0:
	@echo "=== [Phase 0] Boucle haut-parleur -> micro (100 runs) ==="
	cargo test -p sounddrop-modem --test test_phase0_loopback -- --nocapture

phase1:
	@echo "=== [Phase 1] ggwave texte 32o < 10s >=95% ==="
	cargo test -p sounddrop-modem --test test_phase1_ggwave -- --nocapture

phase2:
	@echo "=== [Phase 2] UI Slint états navigables & physique 60 FPS ==="
	$(XVFB) env $(LD_LIB) cargo test -p sounddrop-app --test test_phase2_ui -- --nocapture

phase3:
	@echo "=== [Phase 3] Crypto X25519, HKDF, ChaCha20-Poly1305, SAS & MITM ==="
	cargo test -p sounddrop-crypto --test test_crypto_sas -- --nocapture

phase4:
	@echo "=== [Phase 4] Modem MFSK maison + Erasure Coding ==="
	cargo test -p sounddrop-modem --test test_phase4_mfsk -- --nocapture

phase5:
	@echo "=== [Phase 5] Miniatures BlurHash < 3s & Transfert 3 Ko < 5 min ==="
	cargo test -p sounddrop-payload --test test_phase5_blurhash -- --nocapture

phase6:
	@echo "=== [Phase 6] Ultrasons 17.5-19.5 kHz expérimental ==="
	cargo test -p sounddrop-modem --test test_phase6_ultrasound -- --nocapture

tools:
	@echo "=== Génération des vecteurs de test Python ==="
	python3 tools/python/generate_test_vectors.py

test: phase0 phase1 phase2 phase3 phase4 phase5 phase6 tools
	@echo ""
	@echo "=========================================================="
	@echo "✓ TOUTES LES PHASES (0 à 6) ONT ÉTÉ VALIDÉES AVEC SUCCÈS !"
	@echo "=========================================================="

run:
	$(XVFB) env $(LD_LIB) cargo run -p sounddrop-app

deb:
	@bash tools/package_deb.sh

clean:
	cargo clean
