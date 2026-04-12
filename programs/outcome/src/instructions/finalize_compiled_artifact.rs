use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::{
    errors::OutcomeError,
    instructions::compiled_artifact_chunks::load_blob_from_remaining,
    math::compiled_outcome_v1,
    state::approved_outcome_artifact::{ApprovedOutcomeArtifact, STATUS_PENDING},
};

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(Accounts)]
pub struct FinalizeCompiledArtifact<'info> {
    pub publisher: Signer<'info>,
    #[account(mut)]
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

    let blob = load_blob_from_remaining(artifact, &ctx.remaining_accounts, ctx.program_id)?;
    require!(
        sha256(&blob) == artifact.compiled_artifact_hash,
        OutcomeError::InvalidCompiledArtifactHash
    );

    let parsed = compiled_outcome_v1::parse(&blob)?;
    require!(
        parsed.header.format_version == artifact.format_version,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    artifact.is_finalized = true;
    artifact.updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}
