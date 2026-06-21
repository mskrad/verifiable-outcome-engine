use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};
use solana_bn254::prelude::{alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing};

use crate::errors::OutcomeError;

pub mod vk {
    pub use super::unicorn_g_vk::*;
}

#[path = "unicorn_g_vk.rs"]
mod unicorn_g_vk;

pub const ENTROPY_SOURCE_SLOT_HASH: u8 = 0;
pub const ENTROPY_SOURCE_UNICORN_G: u8 = 1;
pub const UNICORN_G_VERSION: u8 = 1;
pub const UNICORN_G_RANDOMNESS_DOMAIN: &[u8] = b"VRE_UNICORN_G_RANDOMNESS_V1";

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
