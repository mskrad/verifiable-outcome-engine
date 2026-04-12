use anchor_lang::prelude::*;

use crate::state::program_config::ProgramConfig;

// Admin is bound to the payer (signer) at initialization time.
// This prevents front-running: only the actual deployer can bootstrap
// the global ProgramConfig PDA. Admin can be transferred afterwards
// via set_program_config.

#[derive(Accounts)]
pub struct InitializeProgramConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = ProgramConfig::LEN,
        seeds = [b"outcome_program_config"],
        bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeProgramConfig>) -> Result<()> {
    let config = &mut ctx.accounts.program_config;
    config.admin = ctx.accounts.payer.key();
    config.allow_unreviewed_binding = false;
    config.bump = ctx.bumps.program_config;
    config.reserved = [0u8; 62];
    Ok(())
}
