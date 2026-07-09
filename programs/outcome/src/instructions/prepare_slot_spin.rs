//! `prepare_slot_spin` — per-spin bet commitment for SF1 slot artifacts.
//!
//! Additive clone of `prepare_rng_v2` for `FORMAT_VERSION_SLOT`. One spin = one
//! rng_v2 lifecycle: the bet (`input_lamports`) and the player (`actor`, typically an
//! ephemeral session key) are bound and staked into the vault BEFORE the entropy
//! exists, so neither side can bias or cherry-pick the outcome (bet-before-seed).
//!
//! Differences vs `prepare_rng_v2` (fmt 7):
//! - SF1 artifact parse + bet-band check (`slot::parse`), not `parse_snapshot_v4`.
//! - The B-2 `payout_lamports == 0` invariant does not apply: the slot vault is
//!   house-funded and pays variable wins. Instead the vault must cover this spin's
//!   max-win exposure (`slot::max_win_cap`) at prepare time.
//! - Short target offsets `SLOT_RNG_TARGET_OFFSETS = [3,4,5]` (~2s reveal) instead
//!   of `[75,90,105]`.
//! - No bounty and no operator commit: single-phase, permissionless settle crank.
//!
//! Rent for `rng_v2_state` is paid by the actor and refunded when
//! `settle_slot_spin` closes the account (~2s later). Tx fees are a client-side
//! fee-payer concern (operator pays them in the Studio setup).

use anchor_lang::{prelude::*, system_program};
use crate::math::sha::sha256;

use crate::{
    errors::OutcomeError,
    events::SlotSpinPreparedV1,
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    instructions::prepare_rng_v2::{RngV2State, RNG_V2_STATUS_PREPARED},
    math::{rng_v2, slot, unicorn_g},
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact, outcome_config::OutcomeConfig,
        program_config::ProgramConfig,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PrepareSlotSpinArgs {
    pub runtime_id: [u8; 16],
    pub input_lamports: u64,
}

#[derive(Accounts)]
#[instruction(args: PrepareSlotSpinArgs)]
pub struct PrepareSlotSpin<'info> {
    /// The player (session key). Signs the bet, pays the refundable state rent,
    /// and receives the payout at settle.
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    #[account(
        mut,
        seeds = [b"outcome_config", args.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Account<'info, OutcomeConfig>,
    #[account(
        mut,
        seeds = [b"outcome_vault", args.runtime_id.as_ref()],
        bump = outcome_config.vault_bump
    )]
    pub outcome_vault: SystemAccount<'info>,
    #[account(
        init,
        payer = actor,
        space = RngV2State::LEN,
        seeds = [b"rng_v2_state", args.runtime_id.as_ref(), &outcome_config.next_resolve_id.to_le_bytes()],
        bump
    )]
    pub rng_v2_state: Account<'info, RngV2State>,
    #[account(
        seeds = [b"approved_outcome_artifact", outcome_config.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
    pub system_program: Program<'info, System>,
}

fn derive_slot_target_slots(now_slot: u64) -> Result<([u64; 3], u64)> {
    let mut targets = [0u64; 3];
    for (i, off) in slot::SLOT_RNG_TARGET_OFFSETS.iter().enumerate() {
        targets[i] = now_slot
            .checked_add(*off)
            .ok_or(OutcomeError::MathOverflow)?;
    }
    let expiry = targets[2]
        .checked_add(rng_v2::RNG_V2_EXPIRY_AFTER_LAST_TARGET)
        .ok_or(OutcomeError::MathOverflow)?;
    Ok((targets, expiry))
}

pub fn handler(ctx: Context<PrepareSlotSpin>, args: PrepareSlotSpinArgs) -> Result<()> {
    let config = &mut ctx.accounts.outcome_config;
    require!(!config.is_paused, OutcomeError::RuntimePaused);
    config.assert_input_in_range(args.input_lamports)?;

    let artifact = &ctx.accounts.approved_outcome_artifact;
    require!(
        artifact.is_finalized,
        OutcomeError::CompiledArtifactNotFinalized
    );
    require!(
        artifact.compiled_artifact_hash == config.compiled_artifact_hash,
        OutcomeError::ArtifactBindingMismatch
    );
    require!(
        artifact.status_allows_binding(ctx.accounts.program_config.allow_unreviewed_binding),
        OutcomeError::UnapprovedCompiledArtifact
    );
    require!(
        artifact.format_version == slot::FORMAT_VERSION_SLOT,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let blob = load_blob_from_remaining(artifact, ctx.remaining_accounts, ctx.program_id)?;
    require!(
        sha256(&blob) == artifact.compiled_artifact_hash,
        OutcomeError::InvalidCompiledArtifactHash
    );
    let spec = slot::parse(&blob)?;
    require!(
        spec.min_input_lamports == config.min_input_lamports
            && spec.max_input_lamports == config.max_input_lamports,
        OutcomeError::ArtifactBindingMismatch
    );

    // House-funded vault must cover this spin's worst case BEFORE the bet lands.
    // MVP: balance check against a single spin's exposure; concurrent in-flight
    // spins over one vault are an operator-managed liquidity risk (runbook).
    let exposure_cap = slot::max_win_cap(args.input_lamports, spec.max_win_multiplier);
    require!(
        ctx.accounts.outcome_vault.lamports() >= exposure_cap,
        OutcomeError::SlotVaultReserveInsufficient
    );

    // Protocol fee is snapshotted here and taken out of the stake (vault → protocol
    // treasury) at settle. Partner instance runs fee_lamports = 0.
    let fee_snapshot = ctx.accounts.program_config.fee_lamports;
    require!(
        args.input_lamports >= fee_snapshot,
        OutcomeError::RngV2InputBelowFee
    );

    let clock = Clock::get()?;
    let (target_slots, expiry_slot) = derive_slot_target_slots(clock.slot)?;
    let resolve_id = config.next_resolve_id;

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.actor.to_account_info(),
                to: ctx.accounts.outcome_vault.to_account_info(),
            },
        ),
        args.input_lamports,
    )?;

    let state = &mut ctx.accounts.rng_v2_state;
    state.runtime_id = config.runtime_id;
    state.resolve_id = resolve_id;
    state.actor = ctx.accounts.actor.key();
    state.input_lamports = args.input_lamports;
    state.status = RNG_V2_STATUS_PREPARED;
    state.compiled_artifact_hash = config.compiled_artifact_hash;
    state.artifact_format_version = slot::FORMAT_VERSION_SLOT;
    state.snapshot_hash = [0u8; 32]; // SF1 carries no snapshot
    state.target_slots = target_slots;
    state.expiry_slot = expiry_slot;
    state.operator_commit_present = false;
    state.operator_commit_hash = [0u8; 32];
    state.operator_reveal_len = 0;
    state.operator_reveal = [0u8; 32];
    state.resolved_slots = [0u64; 3];
    state.slot_hashes = [[0u8; 32]; 3];
    state.bump = ctx.bumps.rng_v2_state;
    state.bounty_lamports = 0;
    state.fee_snapshot = fee_snapshot;
    state.attest_deadline_slot = expiry_slot;
    state.entropy_source = unicorn_g::ENTROPY_SOURCE_SLOT_HASH;
    state.reserved = [0u8; 7];

    config.next_resolve_id = config
        .next_resolve_id
        .checked_add(1)
        .ok_or(OutcomeError::MathOverflow)?;

    emit!(SlotSpinPreparedV1 {
        runtime_id: config.runtime_id,
        resolve_id,
        actor: ctx.accounts.actor.key(),
        input_lamports: args.input_lamports,
        compiled_artifact_hash: config.compiled_artifact_hash,
        target_slots,
        expiry_slot,
        exposure_cap,
        fee_snapshot,
    });

    Ok(())
}
