use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    state::{program_config::ProgramConfig, upgradeable_loader},
};

// Bootstrap is bound to the current upgrade authority so a fresh deployment
// cannot be captured by the first arbitrary signer that reaches this PDA.

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeProgramConfigArgs {
    pub fee_lamports: u64,
    pub treasury: Pubkey,
}

#[derive(Accounts)]
pub struct InitializeProgramConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
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

pub fn handler(
    ctx: Context<InitializeProgramConfig>,
    args: InitializeProgramConfigArgs,
) -> Result<()> {
    let config = &mut ctx.accounts.program_config;
    config.admin = ctx.accounts.upgrade_authority.key();
    config.allow_unreviewed_binding = false;
    config.bump = ctx.bumps.program_config;
    config.fee_lamports = args.fee_lamports;
    config.treasury = args.treasury;
    config.reserved = [0u8; 22];
    Ok(())
}
