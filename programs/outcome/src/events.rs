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
pub struct OutcomeResolvedV2 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub total_output_lamports: u64,
    pub master_seed: [u8; 32],
    pub randomness: [u8; 32],
    pub compiled_artifact_hash: [u8; 32],
    pub artifact_format_version: u16,
    pub winner_count: u16,
    pub outcome_id_lens: Vec<u8>,
    pub outcome_ids: Vec<[u8; MAX_OUTCOME_ID_BYTES]>,
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
}

#[event]
pub struct OutcomeResolvedV3 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub total_output_lamports: u64,
    pub master_seed: [u8; 32],
    pub randomness: [u8; 32],
    pub compiled_artifact_hash: [u8; 32],
    pub artifact_format_version: u16,
    pub winner_count: u16,
    pub winner_claim_hash: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
}

#[event]
pub struct RngV2Prepared {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub compiled_artifact_hash: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub target_slots: [u64; 3],
    pub expiry_slot: u64,
    pub operator_commit_present: bool,
    pub operator_commit_hash: [u8; 32],
    // --- Outcome Standard v1.3.2 (Tier 0) additive fields (keeper observability) ---
    pub bounty_lamports: u64,
    pub fee_snapshot: u64,
    pub attest_deadline_slot: u64,
}

#[event]
pub struct OutcomeResolvedV4 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub total_output_lamports: u64,
    pub rng_version: u8,
    pub randomness: [u8; 32],
    pub compiled_artifact_hash: [u8; 32],
    pub artifact_format_version: u16,
    pub winner_count: u16,
    pub winner_claim_hash: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub resolved_slots: [u64; 3],
    pub slot_hashes: [[u8; 32]; 3],
    pub operator_commit_present: bool,
    pub operator_commit_hash: [u8; 32],
    pub operator_reveal_len: u8,
    pub operator_reveal: [u8; 32],
}

#[event]
pub struct RngV2Sealed {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub sealer: Pubkey,
    pub actor: Pubkey,
    pub randomness: [u8; 32],
    pub resolved_slots: [u64; 3],
    pub slot_hashes: [[u8; 32]; 3],
    pub bounty_lamports: u64,
    pub sealed_at_slot: u64,
}

#[event]
pub struct RngV2Attested {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub attester: Pubkey,
    pub actor: Pubkey,
    pub winner_claim_hash: [u8; 32],
    pub protocol_revision: u8,
    pub bounty_lamports: u64,
}

#[event]
pub struct RngV2Expired {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports_refunded: u64,
    pub expired_at_slot: u64,
}

#[event]
pub struct RngV2ExpiredSealed {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports_refunded: u64,
    pub input_lamports_slashed: u64,
    pub expired_at_slot: u64,
}

#[event]
pub struct MasterSeedRefreshedV1 {
    pub runtime_id: [u8; 16],
    pub master_seed: [u8; 32],
    pub source_slot: u64,
}
