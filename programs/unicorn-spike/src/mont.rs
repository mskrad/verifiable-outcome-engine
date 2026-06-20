//! Montgomery arithmetic for a fixed odd 128-bit modulus `l` (B4b — fast on-chain modmul).
//!
//! The naive binary mulmod (128 add-iterations per multiply) made the Pocklington check
//! exceed Solana's 1.4M CU. Montgomery REDC does a multiply + reduction in ~constant work
//! (a handful of u64×u64 products), ~100× cheaper, putting Pocklington back in budget.
//!
//! R = 2^128. `l` must be odd (guaranteed: the circuit forces bit0=1). Hot path is
//! `mont_mul`; `MontCtx::new` does the one-time setup (l^{-1} mod 2^128 via Newton, R^2 mod l).

const MASK64: u128 = 0xFFFF_FFFF_FFFF_FFFF;

/// 128x128 -> 256-bit product as (hi, lo), via 64-bit limbs (overflow-safe).
fn mul128(a: u128, b: u128) -> (u128, u128) {
    let (a0, a1) = (a & MASK64, a >> 64);
    let (b0, b1) = (b & MASK64, b >> 64);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;

    let c0 = p00 & MASK64;
    let mut carry = (p00 >> 64) + (p01 & MASK64) + (p10 & MASK64);
    let c1 = carry & MASK64;
    carry = (carry >> 64) + (p01 >> 64) + (p10 >> 64) + (p11 & MASK64);
    let c2 = carry & MASK64;
    carry = (carry >> 64) + (p11 >> 64);
    let c3 = carry & MASK64;

    let lo = c0 | (c1 << 64);
    let hi = c2 | (c3 << 64);
    (hi, lo)
}

/// Naive a*b mod m (used ONCE in setup for R^2 mod l; not on the hot path).
fn naive_mulmod(mut a: u128, mut b: u128, m: u128) -> u128 {
    let mut r: u128 = 0;
    a %= m;
    while b > 0 {
        if b & 1 == 1 {
            r = match r.checked_add(a) {
                Some(s) => if s >= m { s - m } else { s },
                None => a - (m - r),
            };
        }
        a = match a.checked_add(a) {
            Some(s) => if s >= m { s - m } else { s },
            None => a - (m - a),
        };
        b >>= 1;
    }
    r
}

pub struct MontCtx {
    pub l: u128,
    n_prime: u128, // -l^{-1} mod 2^128
    r2: u128,      // R^2 mod l
    one: u128,     // R mod l = to_mont(1)
}

impl MontCtx {
    pub fn new(l: u128) -> Self {
        debug_assert!(l & 1 == 1, "modulus must be odd");
        // l^{-1} mod 2^128 via Newton (x=1 is correct mod 2 since l odd; 7 doublings -> mod 2^128)
        let mut x: u128 = 1;
        let mut i = 0;
        while i < 7 {
            x = x.wrapping_mul(2u128.wrapping_sub(l.wrapping_mul(x)));
            i += 1;
        }
        let n_prime = x.wrapping_neg(); // -l^{-1} mod 2^128
        let r1 = (u128::MAX % l + 1) % l; // 2^128 mod l
        let r2 = naive_mulmod(r1, r1, l); // R^2 mod l
        MontCtx { l, n_prime, r2, one: r1 }
    }

    /// Montgomery product: a*b*R^{-1} mod l, for a,b in [0, l).
    pub fn mont_mul(&self, a: u128, b: u128) -> u128 {
        let (t_hi, t_lo) = mul128(a, b);
        let m = t_lo.wrapping_mul(self.n_prime); // mod 2^128
        let (ml_hi, ml_lo) = mul128(m, self.l);
        // sum = T + m*l; the low 128 bits cancel by construction.
        let (_lo, c1) = t_lo.overflowing_add(ml_lo);
        let (s_hi, c2a) = t_hi.overflowing_add(ml_hi);
        let (s_hi, c2b) = s_hi.overflowing_add(c1 as u128);
        let carry = c2a || c2b;
        if carry {
            // value = 2^128 + s_hi (>= l, < 2l) -> subtract l = s_hi + (2^128 - l), no wrap
            s_hi.wrapping_add(self.l.wrapping_neg())
        } else if s_hi >= self.l {
            s_hi - self.l
        } else {
            s_hi
        }
    }

    pub fn to_mont(&self, x: u128) -> u128 {
        self.mont_mul(x % self.l, self.r2)
    }
    pub fn from_mont(&self, x: u128) -> u128 {
        self.mont_mul(x, 1)
    }

    /// base^exp mod l via Montgomery square-and-multiply.
    pub fn modpow(&self, base: u128, mut exp: u128) -> u128 {
        let b0 = self.to_mont(base);
        let mut b = b0;
        let mut acc = self.one; // to_mont(1)
        while exp > 0 {
            if exp & 1 == 1 {
                acc = self.mont_mul(acc, b);
            }
            b = self.mont_mul(b, b);
            exp >>= 1;
        }
        self.from_mont(acc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn naive_modpow(mut base: u128, mut exp: u128, m: u128) -> u128 {
        if m == 1 { return 0; }
        let mut r: u128 = 1;
        base %= m;
        while exp > 0 {
            if exp & 1 == 1 { r = naive_mulmod(r, base, m); }
            base = naive_mulmod(base, base, m);
            exp >>= 1;
        }
        r
    }

    // simple deterministic PRNG (xorshift128+-ish) to avoid external deps
    struct Rng(u128);
    impl Rng {
        fn next(&mut self) -> u128 {
            let mut x = self.0;
            x ^= x << 31;
            x ^= x >> 17;
            x ^= x << 13;
            self.0 = x;
            // mix both halves
            x.wrapping_mul(0x2545F4914F6CDD1D2545F4914F6CDD1D)
        }
    }

    #[test]
    fn mont_mul_matches_naive_random() {
        let mut rng = Rng(0x9E3779B97F4A7C15_1234_5678_9ABC_DEF0);
        for _ in 0..20000 {
            // odd 128-bit-ish modulus with high bit set (like l)
            let l = (rng.next() | (1u128 << 127) | 1) ;
            let ctx = MontCtx::new(l);
            let a = rng.next() % l;
            let b = rng.next() % l;
            let got = ctx.from_mont(ctx.mont_mul(ctx.to_mont(a), ctx.to_mont(b)));
            let want = naive_mulmod(a, b, l);
            assert_eq!(got, want, "mulmod mismatch a={a} b={b} l={l}");
        }
    }

    #[test]
    fn modpow_matches_naive_random() {
        let mut rng = Rng(0xDEADBEEF_CAFEBABE_0F0F_0F0F_AAAA_5555);
        for _ in 0..5000 {
            let l = rng.next() | (1u128 << 127) | 1;
            let ctx = MontCtx::new(l);
            let base = rng.next() % l;
            let exp = rng.next();
            assert_eq!(ctx.modpow(base, exp), naive_modpow(base, exp, l), "modpow mismatch");
        }
    }

    #[test]
    fn fermat_128bit_prime() {
        // a 31-bit prime embedded in u128 still works; check a Fermat identity
        let p: u128 = 2147483647; // 2^31-1 (prime)
        let ctx = MontCtx::new(p);
        assert_eq!(ctx.modpow(7, p - 1), 1);
    }
}
