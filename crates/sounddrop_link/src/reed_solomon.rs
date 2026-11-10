/// Pure Rust Galois Field GF(2^8) Reed-Solomon Codec.
/// Uses primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1) with roots alpha^1..alpha^n_syms.

const PRIM_POLY: usize = 0x11d;

#[derive(Clone)]
pub struct ReedSolomonCodec {
    exp_table: [u8; 512],
    log_table: [u8; 256],
    generator_dec: Vec<u8>,
    parity_len: usize,
}

impl ReedSolomonCodec {
    /// Creates a codec with `parity_len` parity bytes.
    /// Can correct up to `parity_len / 2` arbitrary byte errors.
    pub fn new(parity_len: usize) -> Self {
        assert!(parity_len > 0 && parity_len <= 32, "Parity length must be in 1..=32");

        let mut exp_table = [0u8; 512];
        let mut log_table = [0u8; 256];

        let mut x = 1usize;
        for i in 0..255 {
            exp_table[i] = x as u8;
            exp_table[i + 255] = x as u8;
            log_table[x] = i as u8;
            x <<= 1;
            if x >= 256 {
                x ^= PRIM_POLY;
            }
        }
        exp_table[510] = exp_table[255];
        exp_table[511] = exp_table[256];

        let mut codec = Self {
            exp_table,
            log_table,
            generator_dec: Vec::new(),
            parity_len,
        };

        codec.generator_dec = codec.build_generator_dec(parity_len);
        codec
    }

    pub fn parity_len(&self) -> usize {
        self.parity_len
    }

    #[inline(always)]
    fn gf_mul(&self, a: u8, b: u8) -> u8 {
        if a == 0 || b == 0 {
            0
        } else {
            let idx = self.log_table[a as usize] as usize + self.log_table[b as usize] as usize;
            self.exp_table[idx]
        }
    }

    #[inline(always)]
    fn gf_div(&self, a: u8, b: u8) -> u8 {
        assert!(b != 0, "Division by zero in GF(2^8)");
        if a == 0 {
            0
        } else {
            let log_a = self.log_table[a as usize] as usize;
            let log_b = self.log_table[b as usize] as usize;
            let idx = (log_a + 255 - log_b) % 255;
            self.exp_table[idx]
        }
    }

    /// Generator polynomial (x - a^1)(x - a^2)...(x - a^n_syms) returned in decreasing degree (excluding leading 1).
    fn build_generator_dec(&self, n_syms: usize) -> Vec<u8> {
        let mut gen = vec![1u8];
        for i in 1..=n_syms {
            let root = self.exp_table[i];
            let mut next_gen = vec![0u8; gen.len() + 1];
            for (j, &coef) in gen.iter().enumerate() {
                next_gen[j] ^= self.gf_mul(coef, root);
                next_gen[j + 1] ^= coef;
            }
            gen = next_gen;
        }
        // gen is currently increasing degree [g0, g1, ..., g_{n-1}, 1]
        // We drop the leading 1 (last element) and reverse to decreasing degree
        let mut g_dec: Vec<u8> = gen[..n_syms].to_vec();
        g_dec.reverse();
        g_dec
    }

    /// Encodes `data` by appending `parity_len` parity bytes.
    pub fn encode(&self, data: &[u8]) -> Vec<u8> {
        let mut out = data.to_vec();
        out.resize(data.len() + self.parity_len, 0);

        let mut remainder = vec![0u8; self.parity_len];

        for &byte in data {
            let factor = byte ^ remainder[0];
            remainder.remove(0);
            remainder.push(0);

            if factor != 0 {
                for (r, &g) in remainder.iter_mut().zip(&self.generator_dec) {
                    *r ^= self.gf_mul(g, factor);
                }
            }
        }

        let data_len = data.len();
        out[data_len..].copy_from_slice(&remainder);
        out
    }

    /// Decodes a received codeword. Corrects up to `parity_len / 2` byte errors.
    pub fn decode(&self, codeword: &[u8]) -> Result<(Vec<u8>, usize), ReedSolomonError> {
        if codeword.len() <= self.parity_len {
            return Err(ReedSolomonError::CodewordTooShort);
        }

        let n = codeword.len();
        let data_len = n - self.parity_len;

        // 1. Calculate syndromes: S_i = codeword(alpha^i) for i in 1..=parity_len
        let mut syndromes = vec![0u8; self.parity_len];
        let mut has_errors = false;

        for i in 0..self.parity_len {
            let alpha = self.exp_table[i + 1];
            let mut syn = 0u8;
            for &byte in codeword {
                syn = self.gf_mul(syn, alpha) ^ byte;
            }
            syndromes[i] = syn;
            if syn != 0 {
                has_errors = true;
            }
        }

        if !has_errors {
            return Ok((codeword[..data_len].to_vec(), 0));
        }

        // 2. Berlekamp-Massey algorithm to find error locator polynomial Lambda(x)
        let mut lambda = vec![1u8];
        let mut b = vec![1u8];
        let mut l = 0usize;

        for m in 0..self.parity_len {
            let mut delta = syndromes[m];
            for j in 1..lambda.len() {
                let s_idx = m as isize - j as isize;
                if s_idx >= 0 {
                    delta ^= self.gf_mul(lambda[j], syndromes[s_idx as usize]);
                }
            }

            b.insert(0, 0);

            if delta != 0 {
                let mut t = lambda.clone();
                if b.len() > t.len() {
                    t.resize(b.len(), 0);
                }
                for (ti, &bi) in t.iter_mut().zip(b.iter()) {
                    *ti ^= self.gf_mul(bi, delta);
                }

                if 2 * l <= m {
                    l = m + 1 - l;
                    let inv_d = self.gf_div(1, delta);
                    b = lambda;
                    for bi in b.iter_mut() {
                        *bi = self.gf_mul(*bi, inv_d);
                    }
                }
                lambda = t;
            }
        }

        while lambda.last() == Some(&0) {
            lambda.pop();
        }

        let num_errors = lambda.len().saturating_sub(1);
        if num_errors == 0 || num_errors > self.parity_len / 2 {
            return Err(ReedSolomonError::UncorrectableErrors);
        }

        // 3. Chien search: find roots of Lambda(x)
        let mut error_positions = Vec::with_capacity(num_errors);
        for i in 0..n {
            let p = n - 1 - i;
            let x_inv = self.exp_table[(255 - (p % 255)) % 255];
            let mut eval = 0u8;
            let mut xp = 1u8;
            for &coef in &lambda {
                eval ^= self.gf_mul(coef, xp);
                xp = self.gf_mul(xp, x_inv);
            }
            if eval == 0 {
                error_positions.push(i);
            }
        }

        if error_positions.len() != num_errors {
            return Err(ReedSolomonError::UncorrectableErrors);
        }

        // 4. Forney algorithm: find error magnitudes
        // Omega(x) = S(x) * Lambda(x) mod x^parity_len
        let mut omega = vec![0u8; self.parity_len];
        for i in 0..self.parity_len {
            for (j, &l_coef) in lambda.iter().enumerate() {
                if i >= j {
                    omega[i] ^= self.gf_mul(l_coef, syndromes[i - j]);
                }
            }
        }

        let mut corrected = codeword.to_vec();
        for &pos in &error_positions {
            let p = n - 1 - pos;
            let x_inv = self.exp_table[(255 - (p % 255)) % 255];

            // Evaluate Omega(X_k^-1)
            let mut num = 0u8;
            let mut xp = 1u8;
            for &coef in &omega {
                num ^= self.gf_mul(coef, xp);
                xp = self.gf_mul(xp, x_inv);
            }

            // Evaluate formal derivative Lambda'(X_k^-1)
            let mut denom = 0u8;
            let mut xp = 1u8;
            for j in (1..lambda.len()).step_by(2) {
                denom ^= self.gf_mul(lambda[j], xp);
                xp = self.gf_mul(self.gf_mul(xp, x_inv), x_inv);
            }

            if denom == 0 {
                return Err(ReedSolomonError::UncorrectableErrors);
            }

            let magnitude = self.gf_div(num, denom);
            corrected[pos] ^= magnitude;
        }

        Ok((corrected[..data_len].to_vec(), error_positions.len()))
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ReedSolomonError {
    #[error("Codeword is shorter than parity symbols")]
    CodewordTooShort,
    #[error("Errors exceed error-correction capacity")]
    UncorrectableErrors,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rs_encode_and_clean_decode() {
        let rs = ReedSolomonCodec::new(8);
        let msg = b"SOUNDDROP_TEST_PAYLOAD_12345";
        let codeword = rs.encode(msg);

        assert_eq!(codeword.len(), msg.len() + 8);
        let (decoded, errors) = rs.decode(&codeword).expect("Clean codeword should decode");
        assert_eq!(decoded, msg);
        assert_eq!(errors, 0);
    }

    #[test]
    fn test_rs_corrects_single_and_multiple_errors() {
        let rs = ReedSolomonCodec::new(8); // fixes up to 4 errors
        let msg = b"HELLO_ACOUSTIC_WORLD_1234";
        let mut codeword = rs.encode(msg);

        // 1 error
        codeword[2] ^= 0x55;
        let (decoded1, errs1) = rs.decode(&codeword).expect("Should fix 1 error");
        assert_eq!(decoded1, msg);
        assert_eq!(errs1, 1);

        // 3 errors total
        codeword[7] ^= 0xAA;
        codeword[15] ^= 0x33;
        let (decoded3, errs3) = rs.decode(&codeword).expect("Should fix 3 errors");
        assert_eq!(decoded3, msg);
        assert_eq!(errs3, 3);

        // 4 errors (at capacity)
        codeword[20] ^= 0x7F;
        let (decoded4, errs4) = rs.decode(&codeword).expect("Should fix 4 errors");
        assert_eq!(decoded4, msg);
        assert_eq!(errs4, 4);

        // 5 errors (exceeds capacity)
        codeword[22] ^= 0x99;
        let result = rs.decode(&codeword);
        assert!(result.is_err(), "Should fail when error count exceeds capacity");
    }
}
