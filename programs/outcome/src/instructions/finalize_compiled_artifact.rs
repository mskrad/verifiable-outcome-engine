use anchor_lang::prelude::*;
use crate::math::sha::sha256;

use crate::{
    errors::OutcomeError,
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    math::compiled_outcome_v1,
    state::approved_outcome_artifact::{ApprovedOutcomeArtifact, STATUS_PENDING},
};

#[derive(Accounts)]
pub struct FinalizeCompiledArtifact<'info> {
    pub publisher: Signer<'info>,
    #[account(
        mut,
        seeds = [b"approved_outcome_artifact", approved_outcome_artifact.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
}

pub fn handler(ctx: Context<FinalizeCompiledArtifact>) -> Result<()> {
    let artifact = &mut ctx.accounts.approved_outcome_artifact;
    require!(
        artifact.status == STATUS_PENDING,
        OutcomeError::InvalidCompiledArtifactStatus
    );
    require!(
        !artifact.is_finalized,
        OutcomeError::InvalidCompiledArtifactStatus
    );
    require_keys_eq!(
        artifact.publisher,
        ctx.accounts.publisher.key(),
        OutcomeError::Unauthorized
    );

    let blob = load_blob_from_remaining(artifact, ctx.remaining_accounts, ctx.program_id)?;
    require!(
        sha256(&blob) == artifact.compiled_artifact_hash,
        OutcomeError::InvalidCompiledArtifactHash
    );

    if artifact.format_version == compiled_outcome_v1::FORMAT_VERSION_V4
        || artifact.format_version == compiled_outcome_v1::FORMAT_VERSION_V1_2_SCALE
        || artifact.format_version == compiled_outcome_v1::FORMAT_VERSION_V1_2_1_SCALE
    {
        let parsed = compiled_outcome_v1::parse_snapshot_v4(&blob)?;
        require!(
            parsed.winners_count > 0,
            OutcomeError::InvalidCompiledArtifactFormat
        );
    } else if artifact.format_version == compiled_outcome_v1::FORMAT_VERSION_V5 {
        let parsed = compiled_outcome_v1::parse(&blob)?;
        require!(
            parsed.header.format_version == compiled_outcome_v1::FORMAT_VERSION_V5
                && parsed.header.winners_count > 0,
            OutcomeError::InvalidCompiledArtifactFormat
        );
    } else if artifact.format_version == crate::math::conditions::FORMAT_VERSION_CONDITIONS {
        // fc7/fv9 conditions: validate the committed artifact structurally (it is not a
        // compiled_outcome_v1 blob). `validate` also enforces the M1/M2 overflow guard.
        let parsed = crate::math::conditions::ConditionsArtifact::from_bytes(&blob)
            .ok_or(OutcomeError::InvalidCompiledArtifactFormat)?;
        require!(parsed.validate(), OutcomeError::InvalidCompiledArtifactFormat);
    } else if artifact.format_version == crate::math::slot::FORMAT_VERSION_SLOT {
        // SF1 (slot): structurally validate the committed game spec (reels / paylines /
        // paytable). `parse` enforces all layout invariants and the exact-length bound.
        crate::math::slot::parse(&blob)?;
    } else {
        let parsed = compiled_outcome_v1::parse(&blob)?;
        require!(
            parsed.header.format_version == artifact.format_version,
            OutcomeError::InvalidCompiledArtifactFormat
        );
    }

    artifact.is_finalized = true;
    artifact.updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}
