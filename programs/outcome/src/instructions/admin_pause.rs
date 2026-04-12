use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    state::{outcome_config::OutcomeConfig, program_config::ProgramConfig},
};

#[derive(Accounts)]
pub struct AdminPause<'info> {
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    #[account(
        mut,
        seeds = [b"outcome_config", outcome_config.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Account<'info, OutcomeConfig>,
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<AdminPause>, paused: bool) -> Result<()> {
    require_runtime_authority_or_program_admin(
        ctx.accounts.authority.key(),
        &ctx.accounts.outcome_config,
        &ctx.accounts.program_config,
    )?;
    ctx.accounts.outcome_config.is_paused = paused;
    Ok(())
}

fn require_runtime_authority_or_program_admin(
    authority: Pubkey,
    outcome_config: &OutcomeConfig,
    program_config: &ProgramConfig,
) -> Result<()> {
    require!(
        authority == outcome_config.authority || authority == program_config.admin,
        OutcomeError::Unauthorized
    );
    Ok(())
}
