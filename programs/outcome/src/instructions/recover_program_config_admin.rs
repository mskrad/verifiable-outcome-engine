use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    state::{program_config::ProgramConfig, upgradeable_loader},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RecoverProgramConfigAdminArgs {
    pub new_admin: Pubkey,
    pub new_treasury: Pubkey,
}

#[derive(Accounts)]
pub struct RecoverProgramConfigAdmin<'info> {
    #[account(
        mut,
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    #[account(
        constraint = upgradeable_loader::programdata_address(program.as_ref())?
            == Some(program_data.key())
    )]
    pub program: Program<'info, crate::program::Outcome>,
    /// CHECK: owner + `UpgradeableLoaderState::ProgramData` layout + upgrade
    /// authority are validated by `upgradeable_loader::upgrade_authority`.
    #[account(
        constraint = upgradeable_loader::upgrade_authority(&program_data)?
            == Some(upgrade_authority.key())
            @ OutcomeError::UnauthorizedAdmin
    )]
    pub program_data: UncheckedAccount<'info>,
    pub upgrade_authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<RecoverProgramConfigAdmin>,
    args: RecoverProgramConfigAdminArgs,
) -> Result<()> {
    ctx.accounts.program_config.admin = args.new_admin;
    ctx.accounts.program_config.treasury = args.new_treasury;
    Ok(())
}
