#!/usr/bin/env python3
"""
Sound Drop v2 - Acoustic Test Vector & Simulated Noise Generator
Generates test vectors with AWGN noise, burst interference, and clock drift simulation.
"""

import json
import math
import os
import random
import sys

SAMPLE_RATE = 48000

PROFILES = {
    "Robuste": {"Ts": 0.048, "samples": 2304, "step": 62.5, "base": 1500.0},
    "Normal":  {"Ts": 0.024, "samples": 1152, "step": 125.0, "base": 1500.0},
    "Rapide":  {"Ts": 0.012, "samples": 576,  "step": 250.0, "base": 1500.0},
    "Ultra":   {"Ts": 0.024, "samples": 1152, "step": 125.0, "base": 17500.0},
}


def generate_chirp(f_start=1500.0, f_end=5500.0, duration=0.050):
    n = int(SAMPLE_RATE * duration)
    samples = []
    k = (f_end - f_start) / duration
    for i in range(n):
        t = i / SAMPLE_RATE
        phi = 2.0 * math.pi * (f_start * t + 0.5 * k * t * t)
        # 5% Tukey window
        w = 1.0
        if i < 0.05 * n:
            w = 0.5 * (1.0 - math.cos(math.pi * i / (0.05 * n)))
        elif i > 0.95 * n:
            w = 0.5 * (1.0 - math.cos(math.pi * (n - 1 - i) / (0.05 * n)))
        samples.append(math.sin(phi) * w * 0.8)
    return samples


def add_awgn_noise(samples, snr_db):
    if len(samples) == 0:
        return samples
    signal_power = sum(s * s for s in samples) / len(samples)
    noise_power = signal_power / (10.0 ** (snr_db / 10.0))
    noise_std = math.sqrt(noise_power)
    return [s + random.gauss(0.0, noise_std) for s in samples]


def add_burst_interference(samples, num_bursts=3, burst_len=120):
    out = list(samples)
    for _ in range(num_bursts):
        start = random.randint(0, max(0, len(out) - burst_len))
        for j in range(start, min(len(out), start + burst_len)):
            out[j] += random.choice([-1.0, 1.0]) * 0.4
    return out


def simulate_clock_drift(samples, ppm=75.0):
    """Simulate clock drift between emitter and receiver DAC/ADC (50-100 ppm)"""
    drift_factor = 1.0 + (ppm / 1_000_000.0)
    out_len = int(len(samples) / drift_factor)
    out = []
    for i in range(out_len):
        orig_idx = i * drift_factor
        idx0 = int(orig_idx)
        idx1 = min(idx0 + 1, len(samples) - 1)
        frac = orig_idx - idx0
        sample = (1.0 - frac) * samples[idx0] + frac * samples[idx1]
        out.append(sample)
    return out


def main():
    print(f"[Python Tools] Generating acoustic test vectors for Sound Drop v2...")
    out_dir = os.path.join(os.path.dirname(__file__), "generated")
    os.makedirs(out_dir, exist_ok=True)

    vectors = {
        "sample_rate": SAMPLE_RATE,
        "profiles": PROFILES,
        "chirp": {
            "duration_ms": 50,
            "samples_count": len(generate_chirp()),
            "f_start": 1500.0,
            "f_end": 5500.0,
        },
        "snr_test_cases": [30, 20, 15, 10, 5],
        "clock_drift_ppm_tested": [50.0, 75.0, 100.0],
    }

    out_file = os.path.join(out_dir, "test_vectors.json")
    with open(out_file, "w") as f:
        json.dump(vectors, f, indent=2)

    print(f"[Python Tools] Wrote test vectors definition to {out_file}")


if __name__ == "__main__":
    main()
