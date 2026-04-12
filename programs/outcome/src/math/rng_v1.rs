use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub fn derive_randomness(
    master_seed: &[u8; 32],
    runtime_id: &[u8; 16],
    resolve_id: u64,
    actor: &Pubkey,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(master_seed.as_ref());
    hasher.update(runtime_id.as_ref());
    hasher.update(resolve_id.to_le_bytes());
    hasher.update(actor.as_ref());
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_stable_randomness_vector() {
        let master_seed = [7u8; 32];
        let runtime_id = [3u8; 16];
        let actor = Pubkey::new_from_array([9u8; 32]);
        let out = derive_randomness(&master_seed, &runtime_id, 42, &actor);
        let expected = [
            206, 209, 45, 43, 76, 60, 78, 171, 86, 155, 253, 79, 109, 128, 83, 34, 56, 52, 254, 14,
            231, 125, 72, 164, 181, 190, 33, 221, 86, 194, 41, 155,
        ];
        assert_eq!(out, expected);
    }

    #[test]
    fn changes_when_actor_changes() {
        let master_seed = [7u8; 32];
        let runtime_id = [3u8; 16];
        let actor_a = Pubkey::new_from_array([9u8; 32]);
        let actor_b = Pubkey::new_from_array([10u8; 32]);
        assert_ne!(
            derive_randomness(&master_seed, &runtime_id, 42, &actor_a),
            derive_randomness(&master_seed, &runtime_id, 42, &actor_b)
        );
    }
}
