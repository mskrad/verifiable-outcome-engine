use anchor_lang::prelude::*;

use crate::state::approved_outcome_artifact::CHUNK_SIZE;

#[account]
pub struct ApprovedOutcomeArtifactChunk {
    pub compiled_artifact_hash: [u8; 32],
    pub chunk_index: u32,
    pub written_len: u16,
    pub data: [u8; CHUNK_SIZE],
}

impl ApprovedOutcomeArtifactChunk {
    pub const LEN: usize = 8 + 32 + 4 + 2 + CHUNK_SIZE;
}
