use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    events::UnicornGConfigInitialized,
    state::{
        program_config::ProgramConfig,
        unicorn_g::{UnicornGConfig, UNICORN_G_DEVNET_RSA_MODULUS_ID},
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeUnicornGConfigArgs {
    pub enabled: bool,
    pub rsa_modulus_id: [u8; 32],
    pub delay_t: u64,
    pub delay_slots: u64,
}

#[derive(Accounts)]
pub struct InitializeUnicornGConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    #[account(
        init,
        payer = admin,
        space = UnicornGConfig::LEN,
        seeds = [b"unicorn_g_config"],
        bump
    )]
    pub unicorn_g_config: Account<'info, UnicornGConfig>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeUnicornGConfig>,
    args: InitializeUnicornGConfigArgs,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.program_config.admin,
        OutcomeError::UnauthorizedAdmin
    );
    require!(
        args.rsa_modulus_id == UNICORN_G_DEVNET_RSA_MODULUS_ID,
        OutcomeError::InvalidUnicornGConfig
    );
    require!(args.delay_t > 0, OutcomeError::InvalidUnicornGConfig);
    require!(args.delay_slots > 0, OutcomeError::InvalidUnicornGConfig);

    let config = &mut ctx.accounts.unicorn_g_config;
    config.admin = ctx.accounts.admin.key();
    config.enabled = args.enabled;
    config.bump = ctx.bumps.unicorn_g_config;
    config.rsa_modulus_id = args.rsa_modulus_id;
    config.delay_t = args.delay_t;
    config.delay_slots = args.delay_slots;
    config.reserved = [0u8; 46];

    emit!(UnicornGConfigInitialized {
        admin: config.admin,
        enabled: config.enabled,
        rsa_modulus_id: config.rsa_modulus_id,
        delay_t: config.delay_t,
        delay_slots: config.delay_slots,
    });

    Ok(())
}
