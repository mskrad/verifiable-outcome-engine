use anchor_lang::prelude::*;

use crate::errors::OutcomeError;

pub const CHUNK_SIZE: usize = 1024;
pub const MAX_CHUNKS: usize = 8;
pub const MAX_ARTIFACT_URI_BYTES: usize = 200;
pub const MAX_WRITE_CHUNK_BYTES: usize = 900;

pub const STATUS_PENDING: u8 = 0;
pub const STATUS_APPROVED: u8 = 1;
pub const STATUS_REJECTED: u8 = 2;
pub const STATUS_DEPRECATED: u8 = 3;

#[account]
pub struct ApprovedOutcomeArtifact {
    pub compiled_artifact_hash: [u8; 32],
    pub publisher: Pubkey,
    pub status: u8,
    pub is_finalized: bool,
    pub format_version: u16,
    pub blob_len: u32,
    pub chunk_count: u16,
    pub artifact_uri_len: u16,
    pub artifact_uri: [u8; MAX_ARTIFACT_URI_BYTES],
    pub audit_hash: [u8; 32],
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
    pub reserved: [u8; 31],
}

impl ApprovedOutcomeArtifact {
    pub const LEN: usize =
        8 + 32 + 32 + 1 + 1 + 2 + 4 + 2 + 2 + MAX_ARTIFACT_URI_BYTES + 32 + 8 + 8 + 1 + 31;

    pub fn chunk_count_for_blob(blob_len: usize) -> Result<u16> {
        require!(blob_len > 0, OutcomeError::InvalidCompiledArtifactFormat);
        let count = blob_len.div_ceil(CHUNK_SIZE);
        require!(
            count <= MAX_CHUNKS,
            OutcomeError::InvalidCompiledArtifactFormat
        );
        Ok(count as u16)
    }

    pub fn expected_chunk_len(&self, chunk_index: u32) -> Result<usize> {
        let chunk_base = (chunk_index as usize)
            .checked_mul(CHUNK_SIZE)
            .ok_or(OutcomeError::MathOverflow)?;
        require!(
            chunk_base < self.blob_len as usize,
            OutcomeError::InvalidCompiledArtifactFormat
        );
        Ok(core::cmp::min(
            CHUNK_SIZE,
            self.blob_len as usize - chunk_base,
        ))
    }

    pub fn status_allows_binding(&self, allow_unreviewed_binding: bool) -> bool {
        if allow_unreviewed_binding {
            self.status == STATUS_APPROVED
                || self.status == STATUS_PENDING
                || self.status == STATUS_DEPRECATED
        } else {
            self.status == STATUS_APPROVED || self.status == STATUS_DEPRECATED
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_artifact(blob_len: u32) -> ApprovedOutcomeArtifact {
        ApprovedOutcomeArtifact {
            compiled_artifact_hash: [0u8; 32],
            publisher: Pubkey::default(),
            status: STATUS_PENDING,
            is_finalized: false,
            format_version: 1,
            blob_len,
            chunk_count: ApprovedOutcomeArtifact::chunk_count_for_blob(blob_len as usize).unwrap(),
            artifact_uri_len: 0,
            artifact_uri: [0u8; MAX_ARTIFACT_URI_BYTES],
            audit_hash: [0u8; 32],
            created_at: 0,
            updated_at: 0,
            bump: 0,
            reserved: [0u8; 31],
        }
    }

    #[test]
    fn computes_chunk_boundaries() {
        let artifact = demo_artifact((CHUNK_SIZE + 17) as u32);
        assert_eq!(artifact.chunk_count, 2);
        assert_eq!(artifact.expected_chunk_len(0).unwrap(), CHUNK_SIZE);
        assert_eq!(artifact.expected_chunk_len(1).unwrap(), 17);
    }
}
