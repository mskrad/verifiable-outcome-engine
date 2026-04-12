use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    state::{
        approved_outcome_artifact::{ApprovedOutcomeArtifact, CHUNK_SIZE, STATUS_PENDING},
        approved_outcome_artifact_chunk::ApprovedOutcomeArtifactChunk,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitCompiledArtifactChunkArgs {
    pub compiled_artifact_hash: [u8; 32],
    pub chunk_index: u32,
}

#[derive(Accounts)]
#[instruction(args: InitCompiledArtifactChunkArgs)]
pub struct InitCompiledArtifactChunk<'info> {
    #[account(mut)]
    pub publisher: Signer<'info>,
    #[account(
        seeds = [b"approved_outcome_artifact", args.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
    #[account(
        init,
        payer = publisher,
        space = ApprovedOutcomeArtifactChunk::LEN,
        seeds = [b"approved_outcome_artifact_chunk", args.compiled_artifact_hash.as_ref(), &args.chunk_index.to_le_bytes()],
        bump
    )]
    pub approved_outcome_artifact_chunk: Account<'info, ApprovedOutcomeArtifactChunk>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitCompiledArtifactChunk>,
    args: InitCompiledArtifactChunkArgs,
) -> Result<()> {
    let artifact = &ctx.accounts.approved_outcome_artifact;
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
    require!(
        args.chunk_index < artifact.chunk_count as u32,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let chunk = &mut ctx.accounts.approved_outcome_artifact_chunk;
    chunk.compiled_artifact_hash = args.compiled_artifact_hash;
    chunk.chunk_index = args.chunk_index;
    chunk.written_len = 0;
    chunk.data = [0u8; CHUNK_SIZE];
    Ok(())
}
