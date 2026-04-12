use anchor_lang::{prelude::*, system_program};
use sha2::{Digest, Sha256};

use crate::{
    errors::OutcomeError,
    events::{OutcomeResolveStartedV1, OutcomeResolvedV1},
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    math::{compiled_outcome_v1, rng_v1},
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact,
        outcome_config::OutcomeConfig,
        outcome_resolution::{OutcomeResolution, RESOLUTION_STATUS_SETTLED},
        program_config::ProgramConfig,
    },
};

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ResolveOutcomeArgs {
    pub runtime_id: [u8; 16],
    pub input_lamports: u64,
}

#[derive(Accounts)]
#[instruction(args: ResolveOutcomeArgs)]
pub struct ResolveOutcome<'info> {
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
        space = OutcomeResolution::LEN,
        seeds = [b"outcome_resolution", args.runtime_id.as_ref(), &outcome_config.next_resolve_id.to_le_bytes()],
        bump
    )]
    pub outcome_resolution: Account<'info, OutcomeResolution>,
    #[account(
        seeds = [b"approved_outcome_artifact", outcome_config.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
    /// CHECK: must equal the treasury pubkey bound inside OutcomeConfig.
    #[account(mut, address = outcome_config.treasury @ OutcomeError::InvalidTreasuryAccount)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ResolveOutcome>, args: ResolveOutcomeArgs) -> Result<()> {
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

    let parsed = compiled_outcome_v1::parse(&blob)?;
    require!(
        parsed.header.min_input_lamports == config.min_input_lamports
            && parsed.header.max_input_lamports == config.max_input_lamports,
        OutcomeError::ArtifactBindingMismatch
    );

    let resolve_id = config.next_resolve_id;
    emit!(OutcomeResolveStartedV1 {
        runtime_id: config.runtime_id,
        resolve_id,
        actor: ctx.accounts.actor.key(),
        input_lamports: args.input_lamports,
    });

    let collect_bet_accounts = system_program::Transfer {
        from: ctx.accounts.actor.to_account_info(),
        to: ctx.accounts.outcome_vault.to_account_info(),
    };
    let collect_bet_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        collect_bet_accounts,
    );
    system_program::transfer(collect_bet_ctx, args.input_lamports)?;

    let randomness = rng_v1::derive_randomness(
        &config.master_seed,
        &config.runtime_id,
        resolve_id,
        &ctx.accounts.actor.key(),
    );
    let selected =
        compiled_outcome_v1::select_outcome(&blob, &parsed, &randomness, args.input_lamports)?;

    if selected.total_output_lamports > 0 {
        let seeds: &[&[u8]] = &[b"outcome_vault", &config.runtime_id, &[config.vault_bump]];
        let signer = &[seeds];
        let payout_accounts = system_program::Transfer {
            from: ctx.accounts.outcome_vault.to_account_info(),
            to: ctx.accounts.actor.to_account_info(),
        };
        let payout_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            payout_accounts,
            signer,
        );
        system_program::transfer(payout_ctx, selected.total_output_lamports)?;
    }

    let resolution = &mut ctx.accounts.outcome_resolution;
    resolution.runtime_id = config.runtime_id;
    resolution.resolve_id = resolve_id;
    resolution.actor = ctx.accounts.actor.key();
    resolution.input_lamports = args.input_lamports;
    resolution.status = RESOLUTION_STATUS_SETTLED;
    resolution.total_output_lamports = selected.total_output_lamports;
    resolution.compiled_artifact_hash = config.compiled_artifact_hash;
    resolution.randomness = randomness;
    resolution.outcome_id_len = selected.outcome_id_len;
    resolution.outcome_id = selected.outcome_id;
    resolution.effect_count = selected.effect_count;
    resolution.effects_digest = selected.effects_digest;
    resolution.bump = ctx.bumps.outcome_resolution;
    resolution.reserved = [0u8; 31];

    config.next_resolve_id = config
        .next_resolve_id
        .checked_add(1)
        .ok_or(OutcomeError::MathOverflow)?;

    emit!(OutcomeResolvedV1 {
        runtime_id: config.runtime_id,
        resolve_id,
        actor: ctx.accounts.actor.key(),
        input_lamports: args.input_lamports,
        total_output_lamports: selected.total_output_lamports,
        master_seed: config.master_seed,
        randomness,
        compiled_artifact_hash: config.compiled_artifact_hash,
        outcome_id_len: selected.outcome_id_len,
        outcome_id: selected.outcome_id,
        effect_count: selected.effect_count,
        effects_digest: selected.effects_digest,
    });

    Ok(())
}
