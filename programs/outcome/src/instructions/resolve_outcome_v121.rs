use anchor_lang::{prelude::*, system_program};
use sha2::{Digest, Sha256};

use crate::{
    errors::OutcomeError,
    events::{OutcomeResolveStartedV1, OutcomeResolvedV3},
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    math::{compiled_outcome_v1, rng_v1},
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact,
        outcome_config::OutcomeConfig,
        outcome_resolution::{OutcomeResolutionV3, RESOLUTION_STATUS_SETTLED},
        program_config::ProgramConfig,
    },
};

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ResolveOutcomeV121Args {
    pub runtime_id: [u8; 16],
    pub input_lamports: u64,
    pub winner_count: u16,
    pub winner_claim_hash: [u8; 32],
    pub outcome_id_len: u8,
    pub outcome_id: [u8; compiled_outcome_v1::MAX_OUTCOME_ID_BYTES],
}

#[derive(Accounts)]
#[instruction(args: ResolveOutcomeV121Args)]
pub struct ResolveOutcomeV121<'info> {
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
        space = OutcomeResolutionV3::LEN,
        seeds = [b"outcome_resolution", args.runtime_id.as_ref(), &outcome_config.next_resolve_id.to_le_bytes()],
        bump
    )]
    pub outcome_resolution: Account<'info, OutcomeResolutionV3>,
    #[account(
        seeds = [b"approved_outcome_artifact", outcome_config.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
    /// CHECK: must equal the treasury pubkey bound inside OutcomeConfig.
    #[account(mut, address = outcome_config.treasury @ OutcomeError::InvalidTreasuryAccount)]
    pub outcome_treasury: UncheckedAccount<'info>,
    /// CHECK: validated manually when fee_lamports > 0.
    #[account(mut)]
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

pub fn handler(ctx: Context<ResolveOutcomeV121>, args: ResolveOutcomeV121Args) -> Result<()> {
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

    let blob = load_blob_from_remaining(artifact, &ctx.remaining_accounts, ctx.program_id)?;
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
    require!(
        args.winner_count == parsed.winners_count,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    validate_primary_outcome_id(args.outcome_id_len, &args.outcome_id)?;

    let resolve_id = config.next_resolve_id;
    emit!(OutcomeResolveStartedV1 {
        runtime_id: config.runtime_id,
        resolve_id,
        actor: ctx.accounts.actor.key(),
        input_lamports: args.input_lamports,
    });

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

    let randomness = rng_v1::derive_randomness(
        &config.master_seed,
        &config.runtime_id,
        resolve_id,
        &ctx.accounts.actor.key(),
    );

    let (total_output_lamports, effect_count, effects_digest) =
        compiled_outcome_v1::synthetic_effects_digest_v4(
            parsed.payout_lamports,
            parsed.winners_count,
        )?;
    if total_output_lamports > 0 {
        let seeds: &[&[u8]] = &[b"outcome_vault", &config.runtime_id, &[config.vault_bump]];
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
    resolution.runtime_id = config.runtime_id;
    resolution.resolve_id = resolve_id;
    resolution.actor = ctx.accounts.actor.key();
    resolution.input_lamports = args.input_lamports;
    resolution.status = RESOLUTION_STATUS_SETTLED;
    resolution.artifact_format_version = artifact.format_version;
    resolution.winner_count = parsed.winners_count;
    resolution.winner_claim_hash = args.winner_claim_hash;
    resolution.total_output_lamports = total_output_lamports;
    resolution.compiled_artifact_hash = config.compiled_artifact_hash;
    resolution.randomness = randomness;
    resolution.outcome_id_len = args.outcome_id_len;
    resolution.outcome_id = args.outcome_id;
    resolution.effect_count = effect_count;
    resolution.effects_digest = effects_digest;
    resolution.bump = ctx.bumps.outcome_resolution;
    resolution.reserved = [0u8; 29];

    config.next_resolve_id = config
        .next_resolve_id
        .checked_add(1)
        .ok_or(OutcomeError::MathOverflow)?;

    emit!(OutcomeResolvedV3 {
        runtime_id: config.runtime_id,
        resolve_id,
        actor: ctx.accounts.actor.key(),
        input_lamports: args.input_lamports,
        total_output_lamports,
        master_seed: config.master_seed,
        randomness,
        compiled_artifact_hash: config.compiled_artifact_hash,
        artifact_format_version: artifact.format_version,
        winner_count: parsed.winners_count,
        winner_claim_hash: args.winner_claim_hash,
        outcome_id_len: args.outcome_id_len,
        outcome_id: args.outcome_id,
        effect_count,
        effects_digest,
    });

    Ok(())
}
