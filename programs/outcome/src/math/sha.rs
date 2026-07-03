//! SHA-256 via `solana_sha256_hasher::hashv` (the `sol_sha256` syscall on-chain,
//! software sha2 off-chain). Incremental updates are buffered and hashed in a
//! single `hashv` call at `finalize`, which is byte-identical to streaming
//! SHA-256 over the concatenation.

/// One-shot SHA-256 (no intermediate copy of `bytes`).
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[bytes]).to_bytes()
}

/// Drop-in replacement for `sha2::Sha256` incremental hashing.
pub struct Sha256 {
    buf: Vec<u8>,
}

impl Sha256 {
    pub fn new() -> Self {
        Self {
            buf: Vec::with_capacity(192),
        }
    }

    pub fn update(&mut self, data: impl AsRef<[u8]>) {
        self.buf.extend_from_slice(data.as_ref());
    }

    pub fn finalize(self) -> [u8; 32] {
        solana_sha256_hasher::hashv(&[&self.buf]).to_bytes()
    }
}

impl Default for Sha256 {
    fn default() -> Self {
        Self::new()
    }
}
