use anchor_lang::prelude::*;

use crate::{errors::OutcomeError, state::program_config::ProgramConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SetProgramConfigArgs {
    pub new_admin: Pubkey,
    pub allow_unreviewed_binding: bool,
}

#[derive(Accounts)]
pub struct SetProgramConfig<'info> {
    #[account(
        mut,
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    pub admin: Signer<'info>,
}

pub fn handler(ctx: Context<SetProgramConfig>, args: SetProgramConfigArgs) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.program_config.admin,
        OutcomeError::UnauthorizedAdmin
    );
    ctx.accounts.program_config.admin = args.new_admin;
    ctx.accounts.program_config.allow_unreviewed_binding = args.allow_unreviewed_binding;
    Ok(())
}
