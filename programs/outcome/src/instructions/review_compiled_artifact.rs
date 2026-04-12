use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    state::{
        approved_outcome_artifact::{
            ApprovedOutcomeArtifact, MAX_ARTIFACT_URI_BYTES, STATUS_APPROVED, STATUS_DEPRECATED,
            STATUS_PENDING, STATUS_REJECTED,
        },
        program_config::ProgramConfig,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ReviewCompiledArtifactArgs {
    pub status: u8,
    pub audit_hash: [u8; 32],
    pub artifact_uri: Vec<u8>,
}

#[derive(Accounts)]
pub struct ReviewCompiledArtifact<'info> {
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    pub admin: Signer<'info>,
    #[account(mut)]
    pub approved_outcome_artifact: Account<'info, ApprovedOutcomeArtifact>,
}

pub fn handler(
    ctx: Context<ReviewCompiledArtifact>,
    args: ReviewCompiledArtifactArgs,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.program_config.admin,
        OutcomeError::UnauthorizedAdmin
    );
    require!(
        args.status == STATUS_APPROVED
            || args.status == STATUS_REJECTED
            || args.status == STATUS_DEPRECATED,
        OutcomeError::InvalidCompiledArtifactStatus
    );
    require!(
        args.artifact_uri.len() <= MAX_ARTIFACT_URI_BYTES,
        OutcomeError::InvalidArtifactUri
    );

    let artifact = &mut ctx.accounts.approved_outcome_artifact;
    if args.status == STATUS_APPROVED || args.status == STATUS_DEPRECATED {
        require!(
            artifact.is_finalized,
            OutcomeError::CompiledArtifactNotFinalized
        );
    }
    if args.status == STATUS_APPROVED {
        require!(
            artifact.status == STATUS_PENDING,
            OutcomeError::InvalidCompiledArtifactStatus
        );
    }

    artifact.status = args.status;
    artifact.audit_hash = args.audit_hash;
    artifact.artifact_uri_len = args.artifact_uri.len() as u16;
    artifact.artifact_uri = [0u8; MAX_ARTIFACT_URI_BYTES];
    artifact.artifact_uri[..args.artifact_uri.len()].copy_from_slice(&args.artifact_uri);
    artifact.updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}
