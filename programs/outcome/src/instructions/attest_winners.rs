use anchor_lang::{prelude::*, system_program};
use sha2::{Digest, Sha256};

use crate::{
    errors::OutcomeError,
    events::{OutcomeResolvedV4, RngV2Attested},
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    instructions::prepare_rng_v2::{RngV2State, RNG_V2_STATUS_SEALED, RNG_V2_STATUS_SETTLED},
    math::{compiled_outcome_v1, rng_v2},
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact,
        outcome_config::OutcomeConfig,
        program_config::ProgramConfig,
    },
};

pub const RESOLUTION_STATUS_SETTLED: u8 = 1;
/// Marks a resolution produced by the v1.3.2 two-phase (seal → attest) lifecycle,
/// distinguishing it from single-phase rng_version=2 resolutions under standard 1.2.1.
pub const PROTOCOL_REVISION_V1_3_2: u8 = 1;

#[account]
pub struct OutcomeResolutionV4 {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub actor: Pubkey,
    pub input_lamports: u64,
    pub status: u8,
    pub rng_version: u8,
    pub artifact_format_version: u16,
    pub winner_count: u16,
    pub winner_claim_hash: [u8; 32],
    pub total_output_lamports: u64,
    pub compiled_artifact_hash: [u8; 32],
    pub randomness: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; compiled_outcome_v1::MAX_OUTCOME_ID_BYTES],
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub resolved_slots: [u64; 3],
    pub slot_hashes: [[u8; 32]; 3],
    pub operator_commit_present: bool,
    pub operator_commit_hash: [u8; 32],
    pub operator_reveal_len: u8,
    pub operator_reveal: [u8; 32],
    pub bump: u8,
    // --- Outcome Standard v1.3.2 (Tier 0) additive fields, carved from reserved(29) ---
    pub protocol_revision: u8,   // 1
    pub bounty_lamports: u64,    // 8
    pub reserved: [u8; 20],
}

impl OutcomeResolutionV4 {
    pub const LEN: usize = 8
        + 16
        + 8
        + 32
        + 8
        + 1
        + 1
        + 2
        + 2
        + 32
        + 8
        + 32
        + 32
        + 1
        + compiled_outcome_v1::MAX_OUTCOME_ID_BYTES
        + 2
        + 32
        + 32
        + 8 * 3
        + 32 * 3
        + 1
        + 32
        + 1
        + 32
        + 1
        + 1
        + 8
        + 20;
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AttestWinnersArgs {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub winner_count: u16,
    pub winner_claim_hash: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; compiled_outcome_v1::MAX_OUTCOME_ID_BYTES],
    pub operator_reveal_len: u8,
    pub operator_reveal: [u8; 32],
}

/// Phase 2 of the v1.3.2 two-phase settle. Allowlisted (operator OR
/// outcome_config.attester_key). Records the official OutcomeResolution, reveals
/// the operator secret for audit, charges the snapshotted protocol fee, and
/// refunds the operator stake.
#[derive(Accounts)]
#[instruction(args: AttestWinnersArgs)]
pub struct AttestWinners<'info> {
    #[account(mut)]
    pub attester: Signer<'info>,
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
        bump = rng_v2_state.bump
    )]
    pub rng_v2_state: Box<Account<'info, RngV2State>>,
    #[account(
        init,
        payer = attester,
        space = OutcomeResolutionV4::LEN,
        seeds = [b"outcome_resolution", args.runtime_id.as_ref(), &args.resolve_id.to_le_bytes()],
        bump
    )]
    pub outcome_resolution: Box<Account<'info, OutcomeResolutionV4>>,
    // PATCH v3.1 lifecycle isolation: bind the artifact PDA to the draw's frozen
    // compiled_artifact_hash (RngV2State), not the mutable outcome_config — a config
    // artifact rotation must not be able to block attesting an open draw.
    #[account(
        seeds = [b"approved_outcome_artifact", rng_v2_state.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Box<Account<'info, ApprovedOutcomeArtifact>>,
    /// CHECK: receives the operator stake refund (input − fee); must equal rng_v2_state.actor.
    #[account(mut, address = rng_v2_state.actor @ OutcomeError::InvalidRngV2State)]
    pub operator: UncheckedAccount<'info>,
    /// CHECK: receives the snapshotted protocol fee out of the stake; must equal ProgramConfig.treasury.
    #[account(mut, address = program_config.treasury @ OutcomeError::InvalidTreasuryAccount)]
    pub protocol_treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

fn validate_primary_outcome_id(outcome_id_len: u8, outcome_id: &[u8]) -> Result<()> {
    require!(
        (1..=compiled_outcome_v1::MAX_OUTCOME_ID_BYTES as u8).contains(&outcome_id_len),
        OutcomeError::InvalidOutcomeId
    );
    let canonical = &outcome_id[..outcome_id_len as usize];
    require!(
        canonical.iter().all(|byte| byte.is_ascii() && !byte.is_ascii_control()),
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

fn validate_operator_reveal(state: &mut RngV2State, args: &AttestWinnersArgs) -> Result<()> {
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

pub fn handler(ctx: Context<AttestWinners>, args: AttestWinnersArgs) -> Result<()> {
    // PATCH v3.1 lifecycle isolation: no is_paused gate (pause blocks new prepare only;
    // refunding an open draw and writing its resolution is always safe) and no bind to
    // outcome_config.compiled_artifact_hash (the draw's hash is frozen in RngV2State).
    let config = &ctx.accounts.outcome_config;

    let state = &mut ctx.accounts.rng_v2_state;
    require!(
        state.status == RNG_V2_STATUS_SEALED,
        OutcomeError::InvalidRngV2Status
    );
    require!(
        state.runtime_id == args.runtime_id && state.resolve_id == args.resolve_id,
        OutcomeError::InvalidRngV2State
    );

    // Allowlist: operator (state.actor) OR a configured attester_key.
    let attester = ctx.accounts.attester.key();
    let attester_configured = config.attester_key != Pubkey::default();
    require!(
        attester == state.actor || (attester_configured && attester == config.attester_key),
        OutcomeError::UnauthorizedRngV2Attester
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
    let parsed = compiled_outcome_v1::parse_snapshot_v4(&blob)?;
    require!(
        parsed.format_version == compiled_outcome_v1::FORMAT_VERSION_V1_2_1_SCALE
            && parsed.format_version == state.artifact_format_version
            && parsed.snapshot_hash == state.snapshot_hash
            && parsed.min_input_lamports == config.min_input_lamports
            && parsed.max_input_lamports == config.max_input_lamports,
        OutcomeError::ArtifactBindingMismatch
    );
    require!(
        args.winner_count == parsed.winners_count,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    validate_primary_outcome_id(args.outcome_id_len, &args.outcome_id)?;

    // Randomness was determined at seal; recompute it deterministically from the
    // slot evidence persisted on-chain (no SlotHashes sysvar needed here).
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

    let (total_output_lamports, effect_count, effects_digest) =
        compiled_outcome_v1::synthetic_effects_digest_v4(
            parsed.payout_lamports,
            parsed.winners_count,
        )?;

    // PATCH v3.1: the protocol fee is taken out of the operator stake (the vault), not
    // charged to the attester — otherwise an external attester_key would subsidize the
    // operator's fee. The fee is the snapshot captured at prepare (admin-raise-proof);
    // input >= fee_snapshot is enforced at prepare. Split the vault stake:
    //   vault → treasury (fee_snapshot)  +  vault → operator (input − fee_snapshot).
    let fee = state.fee_snapshot;
    let refund = state
        .input_lamports
        .checked_sub(fee)
        .ok_or(OutcomeError::MathOverflow)?;
    let vault_seeds: &[&[u8]] = &[b"outcome_vault", &state.runtime_id, &[config.vault_bump]];
    let vault_signer = &[vault_seeds];
    if fee > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.outcome_vault.to_account_info(),
                    to: ctx.accounts.protocol_treasury.to_account_info(),
                },
                vault_signer,
            ),
            fee,
        )?;
    }
    if refund > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.outcome_vault.to_account_info(),
                    to: ctx.accounts.operator.to_account_info(),
                },
                vault_signer,
            ),
            refund,
        )?;
    }

    let resolution = &mut ctx.accounts.outcome_resolution;
    resolution.runtime_id = state.runtime_id;
    resolution.resolve_id = state.resolve_id;
    resolution.actor = state.actor;
    resolution.input_lamports = state.input_lamports;
    resolution.status = RESOLUTION_STATUS_SETTLED;
    resolution.rng_version = rng_v2::RNG_V2_VERSION;
    resolution.artifact_format_version = parsed.format_version;
    resolution.winner_count = parsed.winners_count;
    resolution.winner_claim_hash = args.winner_claim_hash;
    resolution.total_output_lamports = total_output_lamports;
    resolution.compiled_artifact_hash = state.compiled_artifact_hash;
    resolution.randomness = randomness;
    resolution.outcome_id_len = args.outcome_id_len;
    resolution.outcome_id = args.outcome_id;
    resolution.effect_count = effect_count;
    resolution.effects_digest = effects_digest;
    resolution.snapshot_hash = state.snapshot_hash;
    resolution.resolved_slots = state.resolved_slots;
    resolution.slot_hashes = state.slot_hashes;
    resolution.operator_commit_present = state.operator_commit_present;
    resolution.operator_commit_hash = state.operator_commit_hash;
    resolution.operator_reveal_len = state.operator_reveal_len;
    resolution.operator_reveal = state.operator_reveal;
    resolution.bump = ctx.bumps.outcome_resolution;
    resolution.protocol_revision = PROTOCOL_REVISION_V1_3_2;
    resolution.bounty_lamports = state.bounty_lamports;
    resolution.reserved = [0u8; 20];

    state.status = RNG_V2_STATUS_SETTLED;

    emit!(OutcomeResolvedV4 {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        actor: state.actor,
        input_lamports: state.input_lamports,
        total_output_lamports,
        rng_version: rng_v2::RNG_V2_VERSION,
        randomness,
        compiled_artifact_hash: state.compiled_artifact_hash,
        artifact_format_version: parsed.format_version,
        winner_count: parsed.winners_count,
        winner_claim_hash: args.winner_claim_hash,
        outcome_id_len: args.outcome_id_len,
        outcome_id: args.outcome_id,
        effect_count,
        effects_digest,
        snapshot_hash: state.snapshot_hash,
        resolved_slots: state.resolved_slots,
        slot_hashes: state.slot_hashes,
        operator_commit_present: state.operator_commit_present,
        operator_commit_hash: state.operator_commit_hash,
        operator_reveal_len: state.operator_reveal_len,
        operator_reveal: state.operator_reveal,
    });
    emit!(RngV2Attested {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        attester,
        actor: state.actor,
        winner_claim_hash: args.winner_claim_hash,
        protocol_revision: PROTOCOL_REVISION_V1_3_2,
        bounty_lamports: state.bounty_lamports,
    });

    Ok(())
}
