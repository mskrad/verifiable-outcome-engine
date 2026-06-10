use anchor_lang::{prelude::*, system_program};
use sha2::{Digest, Sha256};

use crate::{
    errors::OutcomeError,
    events::RngV2Prepared,
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    math::{compiled_outcome_v1, rng_v2},
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact,
        outcome_config::OutcomeConfig,
        program_config::ProgramConfig,
    },
};

pub const RNG_V2_STATUS_PREPARED: u8 = 1;
pub const RNG_V2_STATUS_SETTLED: u8 = 2;
pub const RNG_V2_STATUS_EXPIRED: u8 = 3;
pub const RNG_V2_STATUS_SEALED: u8 = 4;
pub const RNG_V2_STATUS_EXPIRED_SEALED: u8 = 5;

#[account]
pub struct RngV2State {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub status: u8,
    pub compiled_artifact_hash: [u8; 32],
    pub artifact_format_version: u16,
    pub snapshot_hash: [u8; 32],
    pub target_slots: [u64; 3],
    pub expiry_slot: u64,
    pub operator_commit_present: bool,
    pub operator_commit_hash: [u8; 32],
    pub operator_reveal_len: u8,
    pub operator_reveal: [u8; 32],
    pub resolved_slots: [u64; 3],
    pub slot_hashes: [[u8; 32]; 3],
    pub bump: u8,
    // --- Outcome Standard v1.3.2 (Tier 0) additive fields, carved from reserved(32) ---
    pub bounty_lamports: u64,       // 8 — bounty held on this PDA, paid to sealer / slashed on expire
    pub fee_snapshot: u64,          // 8 — protocol fee captured at prepare (charged at attest)
    pub attest_deadline_slot: u64,  // 8 — after this slot a SEALED draw may be expire_sealed'd
    pub reserved: [u8; 8],
}

impl RngV2State {
    pub const LEN: usize = 8
        + 16
        + 8
        + 32
        + 8
        + 1
        + 32
        + 2
        + 32
        + 8 * 3
        + 8
        + 1
        + 32
        + 1
        + 32
        + 8 * 3
        + 32 * 3
        + 1
        + 8
        + 8
        + 8
        + 8;
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PrepareRngV2Args {
    pub runtime_id: [u8; 16],
    pub input_lamports: u64,
    pub bounty_lamports: u64,
    pub operator_commit_present: bool,
    pub operator_commit_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: PrepareRngV2Args)]
pub struct PrepareRngV2<'info> {
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

pub fn handler(ctx: Context<PrepareRngV2>, args: PrepareRngV2Args) -> Result<()> {
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
    let parsed = compiled_outcome_v1::parse_snapshot_v4(&blob)?;
    require!(
        parsed.format_version == compiled_outcome_v1::FORMAT_VERSION_V1_2_1_SCALE,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        parsed.min_input_lamports == config.min_input_lamports
            && parsed.max_input_lamports == config.max_input_lamports,
        OutcomeError::ArtifactBindingMismatch
    );
    // v1.3.2 B-2: vault holds only Σ input → expire/expire_sealed always covered.
    require!(
        parsed.payout_lamports == 0,
        OutcomeError::RngV2PayoutMustBeZero
    );

    // v1.3.2: snapshot the protocol fee at prepare and require a sufficient bounty.
    let fee_snapshot = ctx.accounts.program_config.fee_lamports;
    let bounty_floor = fee_snapshot
        .checked_add(config.bounty_min)
        .ok_or(OutcomeError::MathOverflow)?;
    require!(
        args.bounty_lamports >= bounty_floor,
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

    // v1.3.2: hold the bounty as lamports on the rng_v2_state PDA (rent-exempt),
    // paid to the sealer on seal_randomness or slashed to treasury on expire.
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
    state.artifact_format_version = parsed.format_version;
    state.snapshot_hash = parsed.snapshot_hash;
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
    state.reserved = [0u8; 8];

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
        snapshot_hash: parsed.snapshot_hash,
        target_slots,
        expiry_slot,
        operator_commit_present: args.operator_commit_present,
        operator_commit_hash: state.operator_commit_hash,
    });

    Ok(())
}
