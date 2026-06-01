use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub fn derive_randomness(
    master_seed: &[u8; 32],
    runtime_id: &[u8; 16],
    resolve_id: u64,
    actor: &Pubkey,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(master_seed);
    hasher.update(runtime_id);
    hasher.update(resolve_id.to_le_bytes());
    hasher.update(actor.as_ref());
    hasher.finalize().into()
}
