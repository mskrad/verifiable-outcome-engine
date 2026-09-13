//! `settle_rng_v2` — single-phase rng_v2 settle (protocol **v1.2**). Restored from the
//! pre-1.3.2 design (INFRA-003): freeze via `prepare_rng_v2`, then one `settle` reads the
//! future SlotHashes, derives randomness, resolves the artifact, records the resolution and
//! executes payout. Closes operator *predictability* (future slot hash) but not no-abort —
//! the right fit for casino/game "simple random" where an untrusted operator is not the
//! threat. For no-abort (untrusted operator) use the v1.3.2 two-phase `seal → attest` path.

use anchor_lang::{prelude::*, solana_program::sysvar, system_program};

use crate::{
    errors::OutcomeError,
    events::OutcomeResolveStartedV1,
    instructions::attest_winners::{OutcomeResolutionV4, RESOLUTION_STATUS_SETTLED},
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    instructions::prepare_rng_v2::{RngV2State, RNG_V2_STATUS_PREPARED, RNG_V2_STATUS_SETTLED},
    instructions::rng_v2_winners,
    math::{compiled_outcome_v1, rng_v2, sha::Sha256, unicorn_g},
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact,
        outcome_config::OutcomeConfig,
        program_config::ProgramConfig,
    },
};

/// Resolution `protocol_revision` tag for the v1.2 single-phase rng_v2 settle
/// (distinguishes it from the v1.3.2 two-phase lifecycle, which uses `1`).
pub const PROTOCOL_REVISION_V1_2: u8 = 2;

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SettleRngV2Args {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub winner_count: u16,
    pub winner_claim_hash: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; compiled_outcome_v1::MAX_OUTCOME_ID_BYTES],
    pub operator_reveal_len: u8,
    pub operator_reveal: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: SettleRngV2Args)]
pub struct SettleRngV2<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Box<Account<'info, ProgramConfig>>,
    #[account(
        mut,
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
        bump = rng_v2_state.bump
    )]
    pub rng_v2_state: Box<Account<'info, RngV2State>>,
    #[account(
        init,
        payer = actor,
        space = OutcomeResolutionV4::LEN,
        seeds = [b"outcome_resolution", args.runtime_id.as_ref(), &args.resolve_id.to_le_bytes()],
        bump
    )]
    pub outcome_resolution: Box<Account<'info, OutcomeResolutionV4>>,
    #[account(
        seeds = [b"approved_outcome_artifact", outcome_config.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Box<Account<'info, ApprovedOutcomeArtifact>>,
    /// CHECK: must equal the treasury pubkey bound inside OutcomeConfig.
    #[account(mut, address = outcome_config.treasury @ OutcomeError::InvalidTreasuryAccount)]
    pub outcome_treasury: UncheckedAccount<'info>,
    /// CHECK: validated manually when fee_lamports > 0.
    #[account(mut)]
    pub protocol_treasury: SystemAccount<'info>,
    /// CHECK: validated manually as the SlotHashes sysvar account.
    pub slot_hashes: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

fn validate_operator_reveal(state: &mut RngV2State, args: &SettleRngV2Args) -> Result<()> {
    if !state.operator_commit_present {
        require!(
            args.operator_reveal_len == 0 && args.operator_reveal == [0u8; 32],
            OutcomeError::InvalidRngV2OperatorReveal
        );
        return Ok(());
    }
    require!(
        (1..=32).contains(&args.operator_reveal_len),
        OutcomeError::InvalidRngV2OperatorReveal
    );
    require!(
        args.operator_reveal[args.operator_reveal_len as usize..]
            .iter()
            .all(|byte| *byte == 0),
        OutcomeError::InvalidRngV2OperatorReveal
    );
    let reveal_hash =
        rng_v2::hash_operator_reveal(&args.operator_reveal[..args.operator_reveal_len as usize]);
    require!(
        reveal_hash == state.operator_commit_hash,
        OutcomeError::InvalidRngV2OperatorReveal
    );
    state.operator_reveal_len = args.operator_reveal_len;
    state.operator_reveal = args.operator_reveal;
    Ok(())
}

pub fn handler(ctx: Context<SettleRngV2>, args: SettleRngV2Args) -> Result<()> {
    if ctx.accounts.program_config.fee_lamports > 0 {
        require_keys_eq!(
            ctx.accounts.protocol_treasury.key(),
            ctx.accounts.program_config.treasury,
            OutcomeError::InvalidTreasuryAccount
        );
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.actor.to_account_info(),
                    to: ctx.accounts.protocol_treasury.to_account_info(),
                },
            ),
            ctx.accounts.program_config.fee_lamports,
        )?;
    }

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
            && state.actor == ctx.accounts.actor.key()
            && state.compiled_artifact_hash == config.compiled_artifact_hash,
        OutcomeError::InvalidRngV2State
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

    validate_operator_reveal(state, &args)?;

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
    let parsed = compiled_outcome_v1::parse_for_rng_v2(&blob)?;
    rng_v2_winners::assert_artifact_binding(
        &parsed,
        state,
        config.min_input_lamports,
        config.max_input_lamports,
    )?;

    let slot_hashes_data = ctx.accounts.slot_hashes.try_borrow_data()?;
    let (resolved_slots, slot_hashes) =
        rng_v2::resolve_slot_hashes(&slot_hashes_data, &state.target_slots)?;
    state.resolved_slots = resolved_slots;
    state.slot_hashes = slot_hashes;

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

    emit!(OutcomeResolveStartedV1 {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        actor: state.actor,
        input_lamports: state.input_lamports,
    });

    let winners = rng_v2_winners::resolve_winners(
        &blob,
        &parsed,
        rng_v2_winners::WinnerClaimArgs {
            winner_count: args.winner_count,
            winner_claim_hash: &args.winner_claim_hash,
            outcome_id_len: args.outcome_id_len,
            outcome_id: &args.outcome_id,
        },
        &randomness,
        state.input_lamports,
    )?;
    let total_output_lamports = winners.total_output_lamports;
    if total_output_lamports > 0 {
        let seeds: &[&[u8]] = &[b"outcome_vault", &state.runtime_id, &[config.vault_bump]];
        let signer = &[seeds];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.outcome_vault.to_account_info(),
                    to: ctx.accounts.actor.to_account_info(),
                },
                signer,
            ),
            total_output_lamports,
        )?;
    }

    let resolution = &mut ctx.accounts.outcome_resolution;
    resolution.runtime_id = state.runtime_id;
    resolution.resolve_id = state.resolve_id;
    resolution.actor = state.actor;
    resolution.input_lamports = state.input_lamports;
    resolution.status = RESOLUTION_STATUS_SETTLED;
    resolution.rng_version = rng_v2::RNG_V2_VERSION;
    resolution.artifact_format_version = parsed.format_version();
    resolution.winner_count = parsed.winners_count();
    resolution.winner_claim_hash = winners.winner_claim_hash;
    resolution.total_output_lamports = total_output_lamports;
    resolution.compiled_artifact_hash = state.compiled_artifact_hash;
    resolution.randomness = randomness;
    resolution.outcome_id_len = winners.outcome_id_len;
    resolution.outcome_id = winners.outcome_id;
    resolution.effect_count = winners.effect_count;
    resolution.effects_digest = winners.effects_digest;
    resolution.snapshot_hash = state.snapshot_hash;
    resolution.resolved_slots = state.resolved_slots;
    resolution.slot_hashes = state.slot_hashes;
    resolution.operator_commit_present = state.operator_commit_present;
    resolution.operator_commit_hash = state.operator_commit_hash;
    resolution.operator_reveal_len = state.operator_reveal_len;
    resolution.operator_reveal = state.operator_reveal;
    resolution.bump = ctx.bumps.outcome_resolution;
    // v1.2 single-phase rng_v2 (SlotHashes entropy, no bounty/two-phase).
    resolution.protocol_revision = PROTOCOL_REVISION_V1_2;
    resolution.bounty_lamports = 0;
    resolution.entropy_source = unicorn_g::ENTROPY_SOURCE_SLOT_HASH;
    resolution.reserved = [0u8; 19];

    state.status = RNG_V2_STATUS_SETTLED;

    rng_v2_winners::emit_resolved(
        state,
        &parsed,
        winners,
        randomness,
        unicorn_g::ENTROPY_SOURCE_SLOT_HASH,
        PROTOCOL_REVISION_V1_2,
    );

    Ok(())
}
