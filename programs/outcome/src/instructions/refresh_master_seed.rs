use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    events::MasterSeedRefreshedV1,
    state::{outcome_config::OutcomeConfig, program_config::ProgramConfig},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RefreshMasterSeedArgs {
    pub runtime_id: [u8; 16],
    pub new_master_seed: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: RefreshMasterSeedArgs)]
pub struct RefreshMasterSeed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    #[account(
        mut,
        seeds = [b"outcome_config", args.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Account<'info, OutcomeConfig>,
}

pub fn handler(ctx: Context<RefreshMasterSeed>, args: RefreshMasterSeedArgs) -> Result<()> {
    require_runtime_authority_or_program_admin(
        ctx.accounts.authority.key(),
        &ctx.accounts.outcome_config,
        &ctx.accounts.program_config,
    )?;

    let config = &mut ctx.accounts.outcome_config;
    config.master_seed = args.new_master_seed;
    config.last_seed_slot = Clock::get()?.slot;

    emit!(MasterSeedRefreshedV1 {
        runtime_id: config.runtime_id,
        master_seed: config.master_seed,
        source_slot: config.last_seed_slot,
    });

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
