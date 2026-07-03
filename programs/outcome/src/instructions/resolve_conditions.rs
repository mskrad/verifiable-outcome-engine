//! `resolve_conditions` — attestation-only resolution for the OddSol `conditions` mode
//! (fc7/fv9). Operator-gated. Loads the committed fc7 artifact from chunk accounts, recomputes
//! every entrant's score `S` and the round ranking ON-CHAIN via `math::conditions`, and emits a
//! `ConditionsResolvedV1` attestation (winners digest + facts-ref root). No fund custody — OddSol
//! escrow does the pro-rata payout; VRE only proves S + ranking. Replay recomputes the same from
//! the committed artifact → MATCH.

use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::{
    errors::OutcomeError,
    events::ConditionsResolvedV1,
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    math::conditions,
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact, outcome_config::OutcomeConfig,
        program_config::ProgramConfig,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ResolveConditionsArgs {
    pub runtime_id: [u8; 16],
}

#[derive(Accounts)]
#[instruction(args: ResolveConditionsArgs)]
pub struct ResolveConditions<'info> {
    /// Operator: the OutcomeConfig `authority` (its creator) or, if set, its `attester_key`.
    pub actor: Signer<'info>,
    #[account(seeds = [b"outcome_program_config"], bump = program_config.bump)]
    pub program_config: Account<'info, ProgramConfig>,
    #[account(
        seeds = [b"outcome_config", args.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Account<'info, OutcomeConfig>,
    #[account(
        seeds = [b"approved_outcome_artifact", outcome_config.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
    // remaining_accounts = the fc7 artifact chunk accounts (in index order).
}

pub fn handler(ctx: Context<ResolveConditions>, args: ResolveConditionsArgs) -> Result<()> {
    let cfg = &ctx.accounts.outcome_config;

    // Operator gate. `initialize_outcome_config` sets `authority = caller` and leaves
    // `attester_key = default` (there is no setter), so the config creator is the operator;
    // a non-default `attester_key` is also accepted for a future delegated-attester path.
    require!(
        ctx.accounts.actor.key() == cfg.authority
            || (cfg.attester_key != Pubkey::default()
                && ctx.accounts.actor.key() == cfg.attester_key),
        OutcomeError::Unauthorized
    );

    // Load the committed fc7 blob; the loader verifies chunk PDAs, the blob hash, and length.
    let blob = load_blob_from_remaining(
        &ctx.accounts.approved_outcome_artifact,
        ctx.remaining_accounts,
        ctx.program_id,
    )?;
    require!(
        ctx.accounts.approved_outcome_artifact.compiled_artifact_hash == cfg.compiled_artifact_hash,
        OutcomeError::InvalidCompiledArtifactHash
    );

    // Parse + structurally validate the fc7 artifact.
    let artifact = conditions::ConditionsArtifact::from_bytes(&blob)
        .ok_or(OutcomeError::InvalidConditionsArtifact)?;
    require!(artifact.validate(), OutcomeError::InvalidConditionsArtifact);

    // Recompute S + ranking on-chain.
    let ranked = conditions::resolve_conditions_artifact(&artifact);

    // Winners digest over ordered all_hit entrants: sha256(Σ wallet ‖ score_fixed_le).
    let mut winner_count: u16 = 0;
    let mut score_sum: u128 = 0;
    let mut wh = Sha256::new();
    for r in ranked.iter().filter(|r| r.all_hit) {
        winner_count = winner_count.saturating_add(1);
        score_sum = score_sum.saturating_add(r.score_fixed as u128);
        wh.update(r.wallet);
        wh.update(r.score_fixed.to_le_bytes());
    }
    let winners_digest: [u8; 32] = wh.finalize().into();

    // Facts-ref root binds the committed per-fixture event_stat_roots (ordered by fixture).
    let mut fh = Sha256::new();
    for f in &artifact.fixtures {
        fh.update(f.event_stat_root);
    }
    let facts_ref_root: [u8; 32] = fh.finalize().into();

    emit!(ConditionsResolvedV1 {
        runtime_id: args.runtime_id,
        operator: ctx.accounts.actor.key(),
        compiled_artifact_hash: cfg.compiled_artifact_hash,
        entrant_count: artifact.entrants.len() as u32,
        winner_count,
        winning_score_sum: score_sum,
        winners_digest,
        facts_ref_root,
    });

    Ok(())
}
