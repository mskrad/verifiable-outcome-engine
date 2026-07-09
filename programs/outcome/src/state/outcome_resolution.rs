use anchor_lang::prelude::*;

use crate::math::compiled_outcome_v1::MAX_OUTCOME_ID_BYTES;

pub const RESOLUTION_STATUS_SETTLED: u8 = 1;
pub const MAX_WINNERS: usize = crate::math::compiled_outcome_v1::MAX_WINNERS;

#[account]
pub struct OutcomeResolution {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub status: u8,
    pub total_output_lamports: u64,
    pub compiled_artifact_hash: [u8; 32],
    pub randomness: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
    pub bump: u8,
    pub reserved: [u8; 31],
}

impl OutcomeResolution {
    pub const LEN: usize =
        8 + 16 + 8 + 32 + 8 + 1 + 8 + 32 + 32 + 1 + MAX_OUTCOME_ID_BYTES + 2 + 32 + 1 + 31;
}

#[account]
pub struct OutcomeResolutionV2 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub status: u8,
    pub artifact_format_version: u16,
    pub winner_count: u16,
    pub total_output_lamports: u64,
    pub compiled_artifact_hash: [u8; 32],
    pub randomness: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub outcome_id_lens: Vec<u8>,
    pub outcome_ids: Vec<[u8; MAX_OUTCOME_ID_BYTES]>,
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
    pub bump: u8,
    pub reserved: [u8; 29],
}

impl OutcomeResolutionV2 {
    pub const LEN: usize = 8
        + 16
        + 8
        + 32
        + 8
        + 1
        + 2
        + 2
        + 8
        + 32
        + 32
        + 1
        + MAX_OUTCOME_ID_BYTES
        + 4
        + MAX_WINNERS
        + 4
        + MAX_WINNERS * MAX_OUTCOME_ID_BYTES
        + 2
        + 32
        + 1
        + 29;
}

#[account]
pub struct OutcomeResolutionV3 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub status: u8,
    pub artifact_format_version: u16,
    pub winner_count: u16,
    pub winner_claim_hash: [u8; 32],
    pub total_output_lamports: u64,
    pub compiled_artifact_hash: [u8; 32],
    pub randomness: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
    pub bump: u8,
    pub reserved: [u8; 29],
}

impl OutcomeResolutionV3 {
    pub const LEN: usize = 8
        + 16
        + 8
        + 32
        + 8
        + 1
        + 2
        + 2
        + 32
        + 8
        + 32
        + 32
        + 1
        + MAX_OUTCOME_ID_BYTES
        + 2
        + 32
        + 1
        + 29;
}
