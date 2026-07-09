use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    state::{
        approved_outcome_artifact::{
            ApprovedOutcomeArtifact, MAX_WRITE_CHUNK_BYTES, STATUS_PENDING,
        },
        approved_outcome_artifact_chunk::ApprovedOutcomeArtifactChunk,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct WriteCompiledArtifactChunkArgs {
    pub compiled_artifact_hash: [u8; 32],
    pub chunk_index: u32,
    pub offset: u16,
    pub data: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(args: WriteCompiledArtifactChunkArgs)]
pub struct WriteCompiledArtifactChunk<'info> {
    pub publisher: Signer<'info>,
    #[account(
        mut,
        seeds = [b"approved_outcome_artifact", args.compiled_artifact_hash.as_ref()],
        bump = approved_outcome_artifact.bump
    )]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
    #[account(
        mut,
        seeds = [b"approved_outcome_artifact_chunk", args.compiled_artifact_hash.as_ref(), &args.chunk_index.to_le_bytes()],
        bump
    )]
    pub approved_outcome_artifact_chunk: Account<'info, ApprovedOutcomeArtifactChunk>,
}

pub fn handler(
    ctx: Context<WriteCompiledArtifactChunk>,
    args: WriteCompiledArtifactChunkArgs,
) -> Result<()> {
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
    require!(
        !args.data.is_empty() && args.data.len() <= MAX_WRITE_CHUNK_BYTES,
        OutcomeError::InvalidChunkWrite
    );
    require!(
        args.chunk_index < artifact.chunk_count as u32,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let chunk = &mut ctx.accounts.approved_outcome_artifact_chunk;
    require!(
        chunk.compiled_artifact_hash == args.compiled_artifact_hash,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        chunk.chunk_index == args.chunk_index,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let start = args.offset as usize;
    let end = start.saturating_add(args.data.len());
    let expected_len = artifact.expected_chunk_len(args.chunk_index)?;
    require!(end <= expected_len, OutcomeError::InvalidChunkWrite);
    require!(
        chunk.written_len as usize == start,
        OutcomeError::InvalidChunkWrite
    );

    chunk.data[start..end].copy_from_slice(&args.data);
    chunk.written_len = end as u16;
    artifact.updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}
