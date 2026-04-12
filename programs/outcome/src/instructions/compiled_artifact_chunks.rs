use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    state::{
        approved_outcome_artifact::ApprovedOutcomeArtifact,
        approved_outcome_artifact_chunk::ApprovedOutcomeArtifactChunk,
    },
};

pub fn load_blob_from_remaining<'info>(
    artifact: &ApprovedOutcomeArtifact,
    remaining: &[AccountInfo<'info>],
    program_id: &Pubkey,
) -> Result<Vec<u8>> {
    let chunk_count = artifact.chunk_count as usize;
    require!(chunk_count > 0, OutcomeError::InvalidArtifactChunkCount);

    if remaining.len() < chunk_count {
        return Err(error!(OutcomeError::MissingArtifactChunk));
    }
    if remaining.len() > chunk_count {
        return Err(error!(OutcomeError::InvalidArtifactChunkCount));
    }

    let mut blob = Vec::with_capacity(artifact.blob_len as usize);
    for index in 0..chunk_count {
        let expected_index =
            u32::try_from(index).map_err(|_| OutcomeError::InvalidArtifactChunkCount)?;
        let (expected_pda, _) = Pubkey::find_program_address(
            &[
                b"approved_outcome_artifact_chunk",
                artifact.compiled_artifact_hash.as_ref(),
                &expected_index.to_le_bytes(),
            ],
            program_id,
        );
        let account_info = &remaining[index];
        require_keys_eq!(
            expected_pda,
            *account_info.key,
            OutcomeError::InvalidArtifactChunkPda
        );
        require_keys_eq!(
            *account_info.owner,
            *program_id,
            OutcomeError::InvalidArtifactChunkPda
        );

        let data = account_info.try_borrow_data()?;
        require!(
            data.len() == ApprovedOutcomeArtifactChunk::LEN,
            OutcomeError::InvalidArtifactChunkPda
        );
        require!(
            &data[..8] == ApprovedOutcomeArtifactChunk::DISCRIMINATOR.as_ref(),
            OutcomeError::InvalidArtifactChunkPda
        );

        let mut hash_bytes = [0u8; 32];
        hash_bytes.copy_from_slice(&data[8..40]);
        require!(
            hash_bytes == artifact.compiled_artifact_hash,
            OutcomeError::InvalidArtifactChunkPda
        );

        let stored_index = u32::from_le_bytes([data[40], data[41], data[42], data[43]]);
        require!(
            stored_index == expected_index,
            OutcomeError::InvalidArtifactChunkPda
        );

        let written_len = u16::from_le_bytes([data[44], data[45]]) as usize;
        let expected_len = artifact.expected_chunk_len(expected_index)?;
        require!(
            written_len == expected_len,
            OutcomeError::BlobNotFullyWritten
        );
        blob.extend_from_slice(&data[46..46 + expected_len]);
    }

    require!(
        blob.len() == artifact.blob_len as usize,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    Ok(blob)
}
