use anchor_lang::prelude::*;

use crate::math::compiled_outcome_v1::MAX_OUTCOME_ID_BYTES;

#[event]
pub struct OutcomeConfigInitializedV1 {
    pub runtime_id: [u8; 16],
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub min_input_lamports: u64,
    pub max_input_lamports: u64,
    pub compiled_artifact_hash: [u8; 32],
}

#[event]
pub struct OutcomeResolveStartedV1 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
}

#[event]
pub struct OutcomeResolvedV1 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub total_output_lamports: u64,
    pub master_seed: [u8; 32],
    pub randomness: [u8; 32],
    pub compiled_artifact_hash: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
}

#[event]
pub struct MasterSeedRefreshedV1 {
    pub runtime_id: [u8; 16],
    pub master_seed: [u8; 32],
    pub source_slot: u64,
}
