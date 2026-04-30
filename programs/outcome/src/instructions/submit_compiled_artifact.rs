use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    math::compiled_outcome_v1::{
        FORMAT_VERSION_V1, FORMAT_VERSION_V2, FORMAT_VERSION_V3, MAX_COMPILED_ARTIFACT_BYTES,
    },
    state::approved_outcome_artifact::{
        ApprovedOutcomeArtifact, MAX_ARTIFACT_URI_BYTES, STATUS_PENDING,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubmitCompiledArtifactArgs {
    pub compiled_artifact_hash: [u8; 32],
    pub format_version: u16,
    pub blob_len: u32,
}

#[derive(Accounts)]
#[instruction(args: SubmitCompiledArtifactArgs)]
pub struct SubmitCompiledArtifact<'info> {
    #[account(mut)]
    pub publisher: Signer<'info>,
    #[account(
        init,
        payer = publisher,
        space = ApprovedOutcomeArtifact::LEN,
        seeds = [b"approved_outcome_artifact", args.compiled_artifact_hash.as_ref()],
        bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SubmitCompiledArtifact>,
    args: SubmitCompiledArtifactArgs,
) -> Result<()> {
    require!(
        args.format_version == FORMAT_VERSION_V1
            || args.format_version == FORMAT_VERSION_V2
            || args.format_version == FORMAT_VERSION_V3,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        args.blob_len as usize <= MAX_COMPILED_ARTIFACT_BYTES,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    let chunk_count = ApprovedOutcomeArtifact::chunk_count_for_blob(args.blob_len as usize)?;

    let artifact = &mut ctx.accounts.approved_outcome_artifact;
    artifact.compiled_artifact_hash = args.compiled_artifact_hash;
    artifact.publisher = ctx.accounts.publisher.key();
    artifact.status = STATUS_PENDING;
    artifact.is_finalized = false;
    artifact.format_version = args.format_version;
    artifact.blob_len = args.blob_len;
    artifact.chunk_count = chunk_count;
    artifact.artifact_uri_len = 0;
    artifact.artifact_uri = [0u8; MAX_ARTIFACT_URI_BYTES];
    artifact.audit_hash = [0u8; 32];
    let now = Clock::get()?.unix_timestamp;
    artifact.created_at = now;
    artifact.updated_at = now;
    artifact.bump = ctx.bumps.approved_outcome_artifact;
    artifact.reserved = [0u8; 31];
    Ok(())
}
