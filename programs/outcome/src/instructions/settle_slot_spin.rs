//! `settle_slot_spin` — single-phase settle of one SF1 slot spin (protocol v1.2 path).
//!
//! Additive clone of `settle_rng_v2` for `FORMAT_VERSION_SLOT`. Reads the matured
//! future SlotHashes frozen by `prepare_slot_spin`, derives per-spin randomness,
//! replays the committed SF1 paytable (`slot::replay_spin`) and pays the win from
//! the house-funded vault.
//!
//! Differences vs `settle_rng_v2` (fmt 7):
//! - **Permissionless crank**: any signer may settle (the operator in the Studio
//!   setup); the payout goes strictly to `state.actor`, never to the signer. The
//!   player does not need a second wallet interaction.
//! - Variable payout = `replay_spin(...)`, clamped by the artifact's
//!   `max_win_multiplier` cap — not the fixed winner-list digest.
//! - No `outcome_resolution` account: the `SlotSpinResolvedV1` event carries
//!   everything needed for replay-by-signature verification.
//! - `rng_v2_state` is **closed** here; its rent returns to the actor. A closed
//!   state cannot be settled twice, and `next_resolve_id` never repeats.
//! - Protocol fee (`state.fee_snapshot`) is taken out of the stake held in the
//!   vault (vault → protocol treasury), not from the crank signer.

use anchor_lang::{prelude::*, solana_program::sysvar, system_program};

use crate::{
    errors::OutcomeError,
    events::SlotSpinResolvedV1,
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    instructions::prepare_rng_v2::{RngV2State, RNG_V2_STATUS_PREPARED},
    math::{rng_v2, sha::Sha256, slot},
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact, outcome_config::OutcomeConfig,
        program_config::ProgramConfig,
    },
};

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SettleSlotSpinArgs {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
}

#[derive(Accounts)]
#[instruction(args: SettleSlotSpinArgs)]
pub struct SettleSlotSpin<'info> {
    /// Permissionless crank — anyone may settle a matured spin.
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Box<Account<'info, ProgramConfig>>,
    #[account(
        seeds = [b"outcome_config", args.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Box<Account<'info, OutcomeConfig>>,
    #[account(
        mut,
        seeds = [b"outcome_vault", args.runtime_id.as_ref()],
        bump = outcome_config.vault_bump
    )]
    pub outcome_vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [b"rng_v2_state", args.runtime_id.as_ref(), &args.resolve_id.to_le_bytes()],
        bump = rng_v2_state.bump,
        close = actor
    )]
    pub rng_v2_state: Box<Account<'info, RngV2State>>,
    /// CHECK: payout + state-rent destination; must equal the actor bound at prepare.
    #[account(mut, address = rng_v2_state.actor @ OutcomeError::InvalidRngV2State)]
    pub actor: UncheckedAccount<'info>,
    #[account(
        seeds = [b"approved_outcome_artifact", outcome_config.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Box<Account<'info, ApprovedOutcomeArtifact>>,
    /// CHECK: validated manually when the snapshotted fee > 0.
    #[account(mut)]
    pub protocol_treasury: SystemAccount<'info>,
    /// CHECK: validated manually as the SlotHashes sysvar account.
    pub slot_hashes: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SettleSlotSpin>, args: SettleSlotSpinArgs) -> Result<()> {
    let config = &ctx.accounts.outcome_config;
    require!(!config.is_paused, OutcomeError::RuntimePaused);

    let state = &mut ctx.accounts.rng_v2_state;
    require!(
        state.status == RNG_V2_STATUS_PREPARED,
        OutcomeError::InvalidRngV2Status
    );
    require!(
        state.runtime_id == args.runtime_id
            && state.resolve_id == args.resolve_id
            && state.compiled_artifact_hash == config.compiled_artifact_hash,
        OutcomeError::InvalidRngV2State
    );
    // Only slot-prepared lifecycles may be settled here (an fmt-7 prepare must go
    // through settle_rng_v2, and vice versa).
    require!(
        state.artifact_format_version == slot::FORMAT_VERSION_SLOT,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let clock = Clock::get()?;
    require!(
        clock.slot > state.target_slots[2],
        OutcomeError::RngV2TargetSlotNotReady
    );
    require!(
        clock.slot <= state.expiry_slot,
        OutcomeError::RngV2SettlementWindowExpired
    );
    require_keys_eq!(
        ctx.accounts.slot_hashes.key(),
        sysvar::slot_hashes::ID,
        OutcomeError::InvalidSlotHashesSysvar
    );

    let artifact = &ctx.accounts.approved_outcome_artifact;
    require!(
        artifact.is_finalized,
        OutcomeError::CompiledArtifactNotFinalized
    );
    require!(
        artifact.compiled_artifact_hash == state.compiled_artifact_hash,
        OutcomeError::ArtifactBindingMismatch
    );
    require!(
        artifact.status_allows_binding(ctx.accounts.program_config.allow_unreviewed_binding),
        OutcomeError::UnapprovedCompiledArtifact
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

    let slot_hashes_data = ctx.accounts.slot_hashes.try_borrow_data()?;
    let (resolved_slots, slot_hashes) =
        rng_v2::resolve_slot_hashes(&slot_hashes_data, &state.target_slots)?;
    state.resolved_slots = resolved_slots;
    state.slot_hashes = slot_hashes;
    drop(slot_hashes_data);

    let seed = rng_v2::derive_seed(
        &state.runtime_id,
        state.resolve_id,
        &state.compiled_artifact_hash,
        &state.snapshot_hash,
        &state.resolved_slots,
        &state.slot_hashes,
        state.operator_commit_present,
        &state.operator_commit_hash,
    );
    let randomness =
        rng_v2::derive_randomness(&seed, &state.runtime_id, state.resolve_id, &state.actor);

    let outcome = slot::replay_spin(&blob, &randomness, state.input_lamports)?;
    let cap = slot::max_win_cap(state.input_lamports, spec.max_win_multiplier);
    let payout_lamports = core::cmp::min(outcome.total_win_lamports, cap);

    let vault_seeds: &[&[u8]] = &[
        b"outcome_vault",
        &state.runtime_id,
        &[config.vault_bump],
    ];
    let vault_signer = &[vault_seeds];

    // Protocol fee comes out of the stake already held in the vault.
    if state.fee_snapshot > 0 {
        require_keys_eq!(
            ctx.accounts.protocol_treasury.key(),
            ctx.accounts.program_config.treasury,
            OutcomeError::InvalidTreasuryAccount
        );
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.outcome_vault.to_account_info(),
                    to: ctx.accounts.protocol_treasury.to_account_info(),
                },
                vault_signer,
            ),
            state.fee_snapshot,
        )?;
    }

    if payout_lamports > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.outcome_vault.to_account_info(),
                    to: ctx.accounts.actor.to_account_info(),
                },
                vault_signer,
            ),
            payout_lamports,
        )?;
    }

    emit!(SlotSpinResolvedV1 {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        actor: state.actor,
        input_lamports: state.input_lamports,
        payout_lamports,
        raw_win_lamports: outcome.total_win_lamports,
        compiled_artifact_hash: state.compiled_artifact_hash,
        randomness,
        reel_count: outcome.reel_count,
        reel_stops: outcome.reel_stops,
        resolved_slots: state.resolved_slots,
        slot_hashes: state.slot_hashes,
        settled_at_slot: clock.slot,
    });

    // rng_v2_state closes via `close = actor` (rent back to the player); a closed
    // state cannot be settled again.
    Ok(())
}
