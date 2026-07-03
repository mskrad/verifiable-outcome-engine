use anchor_lang::prelude::*;
use crate::math::sha::Sha256;
#[cfg(feature = "unicorn-g")]
use solana_bn254::prelude::{alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing};

#[cfg(feature = "unicorn-g")]
use crate::errors::OutcomeError;

#[cfg(feature = "unicorn-g")]
pub mod vk {
    pub use super::unicorn_g_vk::*;
}

#[cfg(feature = "unicorn-g")]
#[path = "unicorn_g_vk.rs"]
mod unicorn_g_vk;

pub const ENTROPY_SOURCE_SLOT_HASH: u8 = 0;
pub const ENTROPY_SOURCE_UNICORN_G: u8 = 1;
pub const UNICORN_G_VERSION: u8 = 1;
pub const UNICORN_G_RANDOMNESS_DOMAIN: &[u8] = b"VRE_UNICORN_G_RANDOMNESS_V1";

pub fn derive_u_from_seed(seed: &[u8; 32]) -> [u64; 32] {
    let mut out = [0u64; 32];
    for index in 0..4 {
        let start = 32 - ((index + 1) * 8);
        let mut limb = [0u8; 8];
        limb.copy_from_slice(&seed[start..start + 8]);
        out[index] = u64::from_be_bytes(limb);
    }
    out[0] |= 1;
    out
}

pub fn hash_limb_bytes(values: &[u64; 32]) -> [u8; 32] {
    let mut preimage = [0u8; 256];
    let mut offset = 0;
    for value in values {
        preimage[offset..offset + 8].copy_from_slice(&value.to_be_bytes());
        offset += 8;
    }
    solana_sha256_hasher::hashv(&[&preimage]).to_bytes()
}

pub fn commit(u: &[u64; 32], y: &[u64; 32]) -> [u8; 32] {
    let mut preimage = [0u8; 512];
    let mut offset = 0;
    for value in u {
        preimage[offset..offset + 8].copy_from_slice(&value.to_be_bytes());
        offset += 8;
    }
    for value in y {
        preimage[offset..offset + 8].copy_from_slice(&value.to_be_bytes());
        offset += 8;
    }
    let mut out = solana_sha256_hasher::hashv(&[&preimage]).to_bytes();
    out[0] &= 0x1f;
    out
}

pub fn derive_randomness(
    y: &[u64; 32],
    runtime_id: &[u8; 16],
    resolve_id: u64,
    actor: &Pubkey,
) -> [u8; 32] {
    let y_hash = hash_limb_bytes(y);
    let mut hasher = Sha256::new();
    hasher.update(UNICORN_G_RANDOMNESS_DOMAIN);
    hasher.update(runtime_id);
    hasher.update(resolve_id.to_le_bytes());
    hasher.update(actor.as_ref());
    hasher.update(y_hash);
    hasher.finalize().into()
}

#[cfg(feature = "unicorn-g")]
pub fn verify_unicorn_proof(
    public_commit: [u8; 32],
    proof_a_neg: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
) -> Result<()> {
    verify_raw(
        &vk::VK_ALPHA_G1,
        &vk::VK_BETA_G2,
        &vk::VK_GAMMA_G2,
        &vk::VK_DELTA_G2,
        &vk::IC,
        &[public_commit],
        proof_a_neg,
        proof_b,
        proof_c,
    )
}

#[cfg(feature = "unicorn-g")]
fn verify_raw(
    alpha_g1: &[u8; 64],
    beta_g2: &[u8; 128],
    gamma_g2: &[u8; 128],
    delta_g2: &[u8; 128],
    ic: &[[u8; 64]],
    public_inputs: &[[u8; 32]],
    proof_a_neg: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
) -> Result<()> {
    require!(
        ic.len() == public_inputs.len() + 1,
        OutcomeError::InvalidUnicornGProof
    );

    let mut vk_x = ic[0].to_vec();
    for (public_input, ic_point) in public_inputs.iter().zip(ic.iter().skip(1)) {
        let mut mul_input = Vec::with_capacity(96);
        mul_input.extend_from_slice(ic_point);
        mul_input.extend_from_slice(public_input);
        let scaled = alt_bn128_multiplication(&mul_input)
            .map_err(|_| error!(OutcomeError::InvalidUnicornGProof))?;

        let mut add_input = Vec::with_capacity(128);
        add_input.extend_from_slice(&vk_x);
        add_input.extend_from_slice(&scaled);
        vk_x = alt_bn128_addition(&add_input)
            .map_err(|_| error!(OutcomeError::InvalidUnicornGProof))?;
    }

    let mut pairing_input = Vec::with_capacity(192 * 4);
    for (g1, g2) in [
        (&proof_a_neg[..], &proof_b[..]),
        (&alpha_g1[..], &beta_g2[..]),
        (&vk_x[..], &gamma_g2[..]),
        (&proof_c[..], &delta_g2[..]),
    ] {
        pairing_input.extend_from_slice(g1);
        pairing_input.extend_from_slice(g2);
    }

    let pairing = alt_bn128_pairing(&pairing_input)
        .map_err(|_| error!(OutcomeError::InvalidUnicornGProof))?;
    require!(
        pairing.len() == 32 && pairing[31] == 1,
        OutcomeError::InvalidUnicornGProof
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_u_limbs_from_big_endian_seed_and_forces_odd_base() {
        let seed = [
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
            0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
            0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1e,
        ];
        let u = derive_u_from_seed(&seed);

        assert_eq!(u[0], 0x18191a1b1c1d1e1f);
        assert_eq!(u[1], 0x1011121314151617);
        assert_eq!(u[2], 0x08090a0b0c0d0e0f);
        assert_eq!(u[3], 0x0001020304050607);
        assert_eq!(&u[4..], &[0u64; 28]);
    }

    #[test]
    fn commit_masks_to_low_253_bits() {
        let u = derive_u_from_seed(&[7u8; 32]);
        let mut y = [0u64; 32];
        y[0] = 1;

        let commit = commit(&u, &y);

        assert_eq!(commit[0] & 0xe0, 0);
    }
}
