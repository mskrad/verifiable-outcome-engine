//! Winner resolution shared by `settle_rng_v2` (v1.2) and `attest_winners` (v1.3.2).
//!
//! INFRA-021: the rng_v2 lifecycle accepts every artifact format.
//! * **Scale (fmt 7)** — the caller claims the winners (`winner_claim_hash`, primary
//!   `outcome_id`); replay proves them against the Merkle snapshot.
//! * **Compact (fmt 1/2/3/5/8)** — the program selects the winners from the on-chain
//!   outcome table with the rng_v2 randomness; caller-supplied winner args must be empty.
//!   `winner_claim_hash` becomes `rng_v2::winner_claim_digest` over the selected list and
//!   the list itself is emitted in `OutcomeResolvedV5`.

use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    events::{OutcomeResolvedV4, OutcomeResolvedV5},
    instructions::prepare_rng_v2::RngV2State,
    math::{
        compiled_outcome_v1::{self, RngV2Artifact, MAX_OUTCOME_ID_BYTES},
        rng_v2,
    },
};

/// Caller-supplied winner claim (identical field set in `SettleRngV2Args` / `AttestWinnersArgs`).
pub struct WinnerClaimArgs<'a> {
    pub winner_count: u16,
    pub winner_claim_hash: &'a [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: &'a [u8; MAX_OUTCOME_ID_BYTES],
}

pub struct RngV2Winners {
    pub total_output_lamports: u64,
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
    pub winner_claim_hash: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    /// Empty for scale draws (list lives in the snapshot).
    pub outcome_id_lens: Vec<u8>,
    pub outcome_ids: Vec<[u8; MAX_OUTCOME_ID_BYTES]>,
}

pub fn validate_primary_outcome_id(outcome_id_len: u8, outcome_id: &[u8]) -> Result<()> {
    require!(
        (1..=MAX_OUTCOME_ID_BYTES as u8).contains(&outcome_id_len),
        OutcomeError::InvalidOutcomeId
    );
    let canonical = &outcome_id[..outcome_id_len as usize];
    require!(
        canonical
            .iter()
            .all(|byte| byte.is_ascii() && !byte.is_ascii_control()),
        OutcomeError::InvalidOutcomeId
    );
    require!(
        outcome_id[outcome_id_len as usize..]
            .iter()
            .all(|byte| *byte == 0),
        OutcomeError::InvalidOutcomeId
    );
    Ok(())
}

/// Bind the artifact parsed at settle/attest time to what `prepare_rng_v2` froze.
pub fn assert_artifact_binding(
    parsed: &RngV2Artifact,
    state: &RngV2State,
    min_input_lamports: u64,
    max_input_lamports: u64,
) -> Result<()> {
    require!(
        parsed.format_version() == state.artifact_format_version
            && parsed.snapshot_hash() == state.snapshot_hash
            && parsed.min_input_lamports() == min_input_lamports
            && parsed.max_input_lamports() == max_input_lamports,
        OutcomeError::ArtifactBindingMismatch
    );
    Ok(())
}

pub fn resolve_winners(
    blob: &[u8],
    parsed: &RngV2Artifact,
    args: WinnerClaimArgs<'_>,
    randomness: &[u8; 32],
    input_lamports: u64,
) -> Result<RngV2Winners> {
    require!(
        args.winner_count == parsed.winners_count(),
        OutcomeError::InvalidCompiledArtifactFormat
    );
    match parsed {
        RngV2Artifact::Scale(snapshot) => {
            validate_primary_outcome_id(args.outcome_id_len, args.outcome_id)?;
            let (total_output_lamports, effect_count, effects_digest) =
                compiled_outcome_v1::synthetic_effects_digest_v4(
                    snapshot.payout_lamports,
                    snapshot.winners_count,
                )?;
            Ok(RngV2Winners {
                total_output_lamports,
                effect_count,
                effects_digest,
                winner_claim_hash: *args.winner_claim_hash,
                outcome_id_len: args.outcome_id_len,
                outcome_id: *args.outcome_id,
                outcome_id_lens: Vec::new(),
                outcome_ids: Vec::new(),
            })
        }
        RngV2Artifact::Compact(artifact) => {
            require!(
                args.outcome_id_len == 0
                    && *args.outcome_id == [0u8; MAX_OUTCOME_ID_BYTES]
                    && *args.winner_claim_hash == [0u8; 32],
                OutcomeError::RngV2CompactArgsMustBeEmpty
            );
            let selected =
                compiled_outcome_v1::select_outcomes(blob, artifact, randomness, input_lamports)?;
            // parse_for_rng_v2 already rejects paying artifacts; keep the invariant local.
            require!(
                selected.total_output_lamports == 0,
                OutcomeError::RngV2PayoutMustBeZero
            );
            let winner_claim_hash =
                rng_v2::winner_claim_digest(&selected.outcome_id_lens, &selected.outcome_ids);
            Ok(RngV2Winners {
                total_output_lamports: 0,
                effect_count: selected.effect_count,
                effects_digest: selected.effects_digest,
                winner_claim_hash,
                outcome_id_len: selected.outcome_id_lens[0],
                outcome_id: selected.outcome_ids[0],
                outcome_id_lens: selected.outcome_id_lens,
                outcome_ids: selected.outcome_ids,
            })
        }
    }
}

/// Emit the resolution event: V4 for scale draws (unchanged wire format), V5 with the
/// winner list for compact draws.
pub fn emit_resolved(
    state: &RngV2State,
    parsed: &RngV2Artifact,
    winners: RngV2Winners,
    randomness: [u8; 32],
    entropy_source: u8,
    protocol_revision: u8,
) {
    if parsed.is_compact() {
        emit!(OutcomeResolvedV5 {
            runtime_id: state.runtime_id,
            resolve_id: state.resolve_id,
            actor: state.actor,
            input_lamports: state.input_lamports,
            total_output_lamports: winners.total_output_lamports,
            rng_version: rng_v2::RNG_V2_VERSION,
            randomness,
            compiled_artifact_hash: state.compiled_artifact_hash,
            artifact_format_version: parsed.format_version(),
            winner_count: parsed.winners_count(),
            winner_claim_hash: winners.winner_claim_hash,
            outcome_id_len: winners.outcome_id_len,
            outcome_id: winners.outcome_id,
            effect_count: winners.effect_count,
            effects_digest: winners.effects_digest,
            snapshot_hash: state.snapshot_hash,
            resolved_slots: state.resolved_slots,
            slot_hashes: state.slot_hashes,
            operator_commit_present: state.operator_commit_present,
            operator_commit_hash: state.operator_commit_hash,
            operator_reveal_len: state.operator_reveal_len,
            operator_reveal: state.operator_reveal,
            entropy_source,
            protocol_revision,
            outcome_id_lens: winners.outcome_id_lens,
            outcome_ids: winners.outcome_ids,
        });
    } else {
        emit!(OutcomeResolvedV4 {
            runtime_id: state.runtime_id,
            resolve_id: state.resolve_id,
            actor: state.actor,
            input_lamports: state.input_lamports,
            total_output_lamports: winners.total_output_lamports,
            rng_version: rng_v2::RNG_V2_VERSION,
            randomness,
            compiled_artifact_hash: state.compiled_artifact_hash,
            artifact_format_version: parsed.format_version(),
            winner_count: parsed.winners_count(),
            winner_claim_hash: winners.winner_claim_hash,
            outcome_id_len: winners.outcome_id_len,
            outcome_id: winners.outcome_id,
            effect_count: winners.effect_count,
            effects_digest: winners.effects_digest,
            snapshot_hash: state.snapshot_hash,
            resolved_slots: state.resolved_slots,
            slot_hashes: state.slot_hashes,
            operator_commit_present: state.operator_commit_present,
            operator_commit_hash: state.operator_commit_hash,
            operator_reveal_len: state.operator_reveal_len,
            operator_reveal: state.operator_reveal,
            entropy_source,
        });
    }
}
