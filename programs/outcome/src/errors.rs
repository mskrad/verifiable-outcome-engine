use anchor_lang::prelude::*;

#[error_code]
pub enum OutcomeError {
    #[msg("Invalid input amount")]
    InvalidInputAmount,
    #[msg("Runtime is paused")]
    RuntimePaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Unauthorized admin")]
    UnauthorizedAdmin,
    #[msg("Invalid compiled artifact format")]
    InvalidCompiledArtifactFormat,
    #[msg("Invalid compiled artifact hash")]
    InvalidCompiledArtifactHash,
    #[msg("Invalid compiled artifact status")]
    InvalidCompiledArtifactStatus,
    #[msg("Compiled artifact is not finalized")]
    CompiledArtifactNotFinalized,
    #[msg("Compiled artifact is not approved for runtime binding")]
    UnapprovedCompiledArtifact,
    #[msg("Invalid artifact uri")]
    InvalidArtifactUri,
    #[msg("Missing compiled artifact chunk")]
    MissingArtifactChunk,
    #[msg("Invalid compiled artifact chunk PDA")]
    InvalidArtifactChunkPda,
    #[msg("Invalid compiled artifact chunk count")]
    InvalidArtifactChunkCount,
    #[msg("Compiled artifact blob not fully written")]
    BlobNotFullyWritten,
    #[msg("Invalid chunk write")]
    InvalidChunkWrite,
    #[msg("Invalid outcome id")]
    InvalidOutcomeId,
    #[msg("Invalid effect type")]
    InvalidEffectType,
    #[msg("Invalid reserved bytes")]
    InvalidReservedBytes,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Artifact binding mismatch")]
    ArtifactBindingMismatch,
    #[msg("Invalid treasury account")]
    InvalidTreasuryAccount,
}
