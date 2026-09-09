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
    #[msg("Invalid RNG v2 state")]
    InvalidRngV2State,
    #[msg("Invalid RNG v2 status")]
    InvalidRngV2Status,
    #[msg("Invalid slot hashes sysvar")]
    InvalidSlotHashesSysvar,
    #[msg("RNG v2 target slot is not ready")]
    RngV2TargetSlotNotReady,
    #[msg("RNG v2 settlement window expired")]
    RngV2SettlementWindowExpired,
    #[msg("RNG v2 slot hash not found")]
    RngV2SlotHashNotFound,
    #[msg("Invalid RNG v2 operator reveal")]
    InvalidRngV2OperatorReveal,
    #[msg("Unauthorized RNG v2 attester")]
    UnauthorizedRngV2Attester,
    #[msg("RNG v2 bounty below required minimum")]
    RngV2BountyTooLow,
    #[msg("RNG v2 artifact payout must be zero")]
    RngV2PayoutMustBeZero,
    #[msg("RNG v2 attest deadline not reached")]
    RngV2AttestDeadlineNotReached,
    #[msg("RNG v2 input below snapshotted protocol fee")]
    RngV2InputBelowFee,
    #[msg("Invalid entropy source")]
    InvalidEntropySource,
    #[msg("Invalid Unicorn-G config")]
    InvalidUnicornGConfig,
    #[msg("Invalid Unicorn-G proof")]
    InvalidUnicornGProof,
    #[msg("Invalid sortition draw")]
    InvalidSortitionDraw,
    #[msg("Invalid sortition status")]
    InvalidSortitionStatus,
    #[msg("Invalid sortition window")]
    InvalidSortitionWindow,
    #[msg("Invalid sortition threshold")]
    InvalidSortitionThreshold,
    #[msg("Invalid sortition commitment")]
    InvalidSortitionCommitment,
    #[msg("Sortition registration is still open")]
    SortitionRegistrationOpen,
    #[msg("Sortition registration is closed")]
    SortitionRegistrationClosed,
    #[msg("Invalid sortition ticket")]
    InvalidSortitionTicket,
    #[msg("Invalid sortition secret")]
    InvalidSortitionSecret,
    #[msg("Sortition predicate not met")]
    SortitionPredicateNotMet,
    #[msg("Sortition ticket already claimed")]
    SortitionAlreadyClaimed,
    #[msg("Sortition claim window is closed")]
    SortitionClaimWindowClosed,
    #[msg("Invalid sortition config")]
    InvalidSortitionConfig,
    #[msg("Sortition ticket cannot be closed before the claim window ends")]
    SortitionCloseTooEarly,
    #[msg("Invalid close skim basis points")]
    InvalidSkimBps,
    #[msg("Invalid entry fee")]
    InvalidEntryFee,
    #[msg("Sortition economics already set for this draw")]
    SortitionEconomicsAlreadySet,
    #[msg("This draw requires paid registration")]
    SortitionPaidRegistrationRequired,
    #[msg("Sortition economics must be set before the first registration")]
    SortitionEconomicsAfterRegistration,
    #[msg("Invalid conditions artifact")]
    InvalidConditionsArtifact,
    #[msg("Vault balance below the max-win exposure for this spin")]
    SlotVaultReserveInsufficient,
    #[msg("RNG v2 compact draw: winner args must be empty, the program selects winners")]
    RngV2CompactArgsMustBeEmpty,
}
