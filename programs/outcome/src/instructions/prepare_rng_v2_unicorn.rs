use anchor_lang::{prelude::*, system_program};
use crate::math::sha::sha256;

use crate::{
    errors::OutcomeError,
    events::RngV2Prepared,
    instructions::{
        compiled_artifact_chunks::load_blob_from_remaining,
        prepare_rng_v2::{PrepareRngV2Args, RngV2State, RNG_V2_STATUS_PREPARED},
    },
    math::{compiled_outcome_v1, rng_v2, unicorn_g},
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact,
        outcome_config::OutcomeConfig,
        program_config::ProgramConfig,
        unicorn_g::{UnicornGConfig, UNICORN_G_DEVNET_RSA_MODULUS_ID},
    },
};

#[derive(Accounts)]
#[instruction(args: PrepareRngV2Args)]
pub struct PrepareRngV2Unicorn<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    #[account(
        seeds = [b"unicorn_g_config"],
        bump = unicorn_g_config.bump
    )]
    pub unicorn_g_config: Account<'info, UnicornGConfig>,
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

pub fn handler(ctx: Context<PrepareRngV2Unicorn>, args: PrepareRngV2Args) -> Result<()> {
    let unicorn_config = &ctx.accounts.unicorn_g_config;
    require!(unicorn_config.enabled, OutcomeError::InvalidUnicornGConfig);
    require!(
        unicorn_config.rsa_modulus_id == UNICORN_G_DEVNET_RSA_MODULUS_ID,
        OutcomeError::InvalidUnicornGConfig
    );

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

    let blob = load_blob_from_remaining(artifact, ctx.remaining_accounts, ctx.program_id)?;
    require!(
        sha256(&blob) == artifact.compiled_artifact_hash,
        OutcomeError::InvalidCompiledArtifactHash
    );
    // INFRA-021: every artifact format (scale fmt 7 or compact fmt 1/2/3/5/8), all
    // payout-free — v1.3.2 B-2: vault holds only Σ input → expire/expire_sealed always covered.
    let parsed = compiled_outcome_v1::parse_for_rng_v2(&blob)?;
    require!(
        parsed.min_input_lamports() == config.min_input_lamports
            && parsed.max_input_lamports() == config.max_input_lamports,
        OutcomeError::ArtifactBindingMismatch
    );
    let artifact_format_version = parsed.format_version();
    let snapshot_hash = parsed.snapshot_hash();

    let fee_snapshot = ctx.accounts.program_config.fee_lamports;
    require!(
        args.input_lamports >= fee_snapshot,
        OutcomeError::RngV2InputBelowFee
    );
    require!(
        args.bounty_lamports >= config.bounty_min,
        OutcomeError::RngV2BountyTooLow
    );

    let clock = Clock::get()?;
    let (target_slots, expiry_slot) = rng_v2::derive_target_slots(clock.slot)?;
    let attest_deadline_slot = expiry_slot
        .checked_add(rng_v2::RNG_V2_ATTEST_DEADLINE_AFTER_EXPIRY)
        .ok_or(OutcomeError::MathOverflow)?;
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

    if args.bounty_lamports > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.actor.to_account_info(),
                    to: ctx.accounts.rng_v2_state.to_account_info(),
                },
            ),
            args.bounty_lamports,
        )?;
    }

    let state = &mut ctx.accounts.rng_v2_state;
    state.runtime_id = config.runtime_id;
    state.resolve_id = resolve_id;
    state.actor = ctx.accounts.actor.key();
    state.input_lamports = args.input_lamports;
    state.status = RNG_V2_STATUS_PREPARED;
    state.compiled_artifact_hash = config.compiled_artifact_hash;
    state.artifact_format_version = artifact_format_version;
    state.snapshot_hash = snapshot_hash;
    state.target_slots = target_slots;
    state.expiry_slot = expiry_slot;
    state.operator_commit_present = args.operator_commit_present;
    state.operator_commit_hash = if args.operator_commit_present {
        args.operator_commit_hash
    } else {
        [0u8; 32]
    };
    state.operator_reveal_len = 0;
    state.operator_reveal = [0u8; 32];
    state.resolved_slots = [0u64; 3];
    state.slot_hashes = [[0u8; 32]; 3];
    state.bump = ctx.bumps.rng_v2_state;
    state.bounty_lamports = args.bounty_lamports;
    state.fee_snapshot = fee_snapshot;
    state.attest_deadline_slot = attest_deadline_slot;
    state.entropy_source = unicorn_g::ENTROPY_SOURCE_UNICORN_G;
    state.reserved = [0u8; 7];

    config.next_resolve_id = config
        .next_resolve_id
        .checked_add(1)
        .ok_or(OutcomeError::MathOverflow)?;

    emit!(RngV2Prepared {
        runtime_id: config.runtime_id,
        resolve_id,
        actor: ctx.accounts.actor.key(),
        input_lamports: args.input_lamports,
        compiled_artifact_hash: config.compiled_artifact_hash,
        snapshot_hash,
        target_slots,
        expiry_slot,
        operator_commit_present: args.operator_commit_present,
        operator_commit_hash: state.operator_commit_hash,
        bounty_lamports: args.bounty_lamports,
        fee_snapshot,
        attest_deadline_slot,
        entropy_source: state.entropy_source,
    });

    Ok(())
}
