//! On-chain Pocklington primality verifier for the Fiat-Shamir prime `l` (A' design).
//!
//! The SNARK proves `l = forcedBits(SHA256(commit||nonce))` and the Wesolowski equation
//! with that `l`, but does NOT prove `l` prime. Soundness needs `l` prime (a non-prime `l`
//! could let a prover forge the Wesolowski proof). We check primality HERE, on-chain, with
//! a deterministic Pocklington certificate — cheap (a few 128-bit modexp), no oracle.
//!
//! Certificate for a ~128-bit candidate `l`:
//!   l - 1 = F * R,  F = prod(factors),  F > sqrt(l)  (i.e. F*F > l),
//!   factors[] are primes, and for a base `a`:
//!     a^(l-1) ≡ 1 (mod l)                              (Fermat)
//!     gcd(a^((l-1)/q) - 1, l) = 1   for every prime q | F
//! Then `l` is prime (Pocklington's theorem). We additionally verify each factor is prime
//! by trial division (the prover supplies small prime factors), so a composite passed as a
//! "factor" cannot forge the certificate.

// Modular multiply/exponentiation come from the Montgomery module (B4b) — the naive
// binary mulmod blew the on-chain CU budget. crate::mont::MontCtx::modpow is ~100x cheaper.
use crate::mont::MontCtx;

fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

/// Trial-division primality for the (small) certificate factors. Cheap for q up to ~2^40.
fn is_prime_trial(q: u128) -> bool {
    if q < 2 {
        return false;
    }
    if q % 2 == 0 {
        return q == 2;
    }
    let mut d: u128 = 3;
    while d.checked_mul(d).map_or(false, |dd| dd <= q) {
        if q % d == 0 {
            return false;
        }
        d += 2;
    }
    true
}

/// A Pocklington certificate for a candidate `l`.
pub struct PocklingtonCert {
    pub l: u128,
    pub f: u128,            // factored part of l-1
    pub r: u128,            // cofactor: l-1 = f*r
    pub a: u128,            // witness base
    pub factors: [u128; 8], // prime factors of f (unused slots = 0)
    pub n_factors: u8,
}

/// Returns true iff the certificate proves `l` is prime.
pub fn pocklington_verify(c: &PocklingtonCert) -> bool {
    let l = c.l;
    if l < 3 || l & 1 == 0 {
        return false;
    }
    // 1. l - 1 == f * r
    let lm1 = l - 1;
    match c.f.checked_mul(c.r) {
        Some(p) if p == lm1 => {}
        _ => return false,
    }
    // 2. f is FULLY factored over the listed DISTINCT primes (handles prime powers in l-1):
    //    every listed q is prime and divides f, and dividing f by all of them leaves 1.
    let n = c.n_factors as usize;
    if n == 0 || n > c.factors.len() {
        return false;
    }
    let mut tmp = c.f;
    for i in 0..n {
        let q = c.factors[i];
        if q < 2 || !is_prime_trial(q) || c.f % q != 0 {
            return false;
        }
        while tmp % q == 0 {
            tmp /= q;
        }
    }
    if tmp != 1 {
        return false; // f has a prime factor not in the list -> not fully factored
    }
    // f > sqrt(l): if f*f overflows u128 then f > 2^64 >= sqrt(l) (l < 2^128) -> true.
    match c.f.checked_mul(c.f) {
        Some(ff) => {
            if ff <= l {
                return false;
            }
        }
        None => {}
    }
    // 3. Fermat: a^(l-1) == 1 (mod l)   (l is odd, checked above -> Montgomery applies)
    if c.a < 2 || c.a >= l {
        return false;
    }
    let ctx = MontCtx::new(l);
    if ctx.modpow(c.a, lm1) != 1 {
        return false;
    }
    // 4. for each prime q | f: gcd(a^((l-1)/q) - 1, l) == 1
    for i in 0..n {
        let q = c.factors[i];
        let e = lm1 / q; // exact since q | f | (l-1)
        let g = ctx.modpow(c.a, e);
        let gm1 = if g == 0 { l - 1 } else { g - 1 };
        if gcd(gm1, l) != 1 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    // build cert from DISTINCT primes: f = product of q^v_q(l-1) over the listed primes.
    fn cert(l: u128, a: u128, distinct: &[u128]) -> PocklingtonCert {
        let lm1 = l - 1;
        let mut f: u128 = 1;
        for &q in distinct {
            let mut t = lm1;
            while t % q == 0 {
                f *= q;
                t /= q;
            }
        }
        assert_eq!(lm1 % f, 0, "f must divide l-1");
        let mut fa = [0u128; 8];
        for (i, &q) in distinct.iter().enumerate() {
            fa[i] = q;
        }
        PocklingtonCert { l, f, r: lm1 / f, a, factors: fa, n_factors: distinct.len() as u8 }
    }

    #[test]
    fn accepts_known_prime() {
        // l = 2*3*5*7*11*13*17*19 ... pick l with easily factored l-1.
        // l = 211 (prime); l-1 = 210 = 2*3*5*7. F=2*3*5*7=210 > sqrt(211). base 2.
        let c = cert(211, 2, &[2, 3, 5, 7]);
        // 210 > sqrt(211)≈14.5 so full factorization works.
        assert!(pocklington_verify(&c));
    }

    #[test]
    fn accepts_128bit_prime() {
        // a 128-bit prime with smooth l-1. l-1 = 2^a * small primes chosen so F>sqrt(l).
        // Use l = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF61? Hard to hand-factor. Instead build l
        // from a known smooth structure: l = 2*3*5*7*11*13*...*P + 1 until prime — done in JS.
        // Here just sanity a mid-size prime: l=4294967311 (prime), l-1=2*3*5*... factor:
        // 4294967310 = 2*3*5*11*13*... compute: 4294967310 = 2 × 3 × 5 × 143165577 ... messy.
        // Keep this test to the small deterministic one above; full 128-bit covered in JS gen.
        let p: u128 = 2147483647; // Mersenne prime 2^31-1
        // p-1 = 2147483646 = 2 × 3^2 × 7 × 11 × 31 × 151 × 331 (distinct primes below)
        let c = cert(p, 7, &[2, 3, 7, 11, 31, 151, 331]);
        assert!(pocklington_verify(&c));
    }

    #[test]
    fn rejects_composite() {
        // l = 221 = 13*17 (composite). l-1 = 220 = 2^2*5*11. A valid-looking F but Fermat fails.
        let c = cert(221, 2, &[2, 5, 11]);
        assert!(!pocklington_verify(&c));
    }

    #[test]
    fn rejects_bad_factor_product() {
        // factors don't multiply to f / don't divide l-1 properly -> reject.
        let mut c = cert(211, 2, &[2, 3, 5, 7]);
        c.f = 209; // wrong
        assert!(!pocklington_verify(&c));
    }

    #[test]
    fn rejects_composite_factor() {
        // pass a composite (9) as a "prime factor" -> is_prime_trial rejects.
        // l = 19, l-1 = 18 = 2*3^2; pass 9 (composite) as a "prime" -> reject on factor primality.
        let c = cert(19, 2, &[2, 9]);
        assert!(!pocklington_verify(&c));
    }

    #[test]
    fn rejects_small_f() {
        // F <= sqrt(l): l=101 (prime), l-1=100=2^2*5^2; list only {2} -> F=4 < sqrt(101)≈10 -> reject.
        let c = cert(101, 2, &[2]); // f=4, r=25 (computed); f*f=16 <= 101
        assert!(!pocklington_verify(&c));
    }
}
