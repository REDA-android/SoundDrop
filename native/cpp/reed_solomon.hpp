// SoundDrop v6.0 — Native C++20 Galois Field GF(2^8) & Luby Transform Fountain Codec
// Provides zero-overhead GF(256) arithmetic (primitive polynomial 0x11D) and
// rateless XOR block droplet assembly for acoustic and optical QR channels.

#pragma once

#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace sounddrop::dsp {

class GaloisField256 {
public:
    static constexpr uint16_t PRIMITIVE_POLY = 0x11D;

    constexpr GaloisField256() : exp_table_{}, log_table_{} {
        uint16_t x = 1;
        for (int i = 0; i < 255; ++i) {
            exp_table_[i] = static_cast<uint8_t>(x);
            exp_table_[i + 255] = static_cast<uint8_t>(x);
            log_table_[x] = static_cast<uint8_t>(i);
            x <<= 1;
            if (x & 0x100) {
                x ^= PRIMITIVE_POLY;
            }
        }
        exp_table_[510] = exp_table_[0];
        exp_table_[511] = exp_table_[1];
    }

    [[nodiscard]] constexpr uint8_t mul(uint8_t a, uint8_t b) const noexcept {
        if (a == 0 || b == 0) return 0;
        return exp_table_[log_table_[a] + log_table_[b]];
    }

    [[nodiscard]] constexpr uint8_t div(uint8_t a, uint8_t b) const {
        if (b == 0) throw std::domain_error("GF(256) division by zero");
        if (a == 0) return 0;
        return exp_table_[log_table_[a] + 255 - log_table_[b]];
    }

    static void xor_block(std::vector<uint8_t>& dst, const std::vector<uint8_t>& src) noexcept {
        const size_t n = dst.size() < src.size() ? dst.size() : src.size();
        for (size_t i = 0; i < n; ++i) {
            dst[i] ^= src[i];
        }
    }

private:
    std::array<uint8_t, 512> exp_table_;
    std::array<uint8_t, 256> log_table_;
};

} // namespace sounddrop::dsp
