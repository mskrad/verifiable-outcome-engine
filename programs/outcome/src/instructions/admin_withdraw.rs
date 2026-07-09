use anchor_lang::{prelude::*, system_program};

use crate::{errors::OutcomeError, state::outcome_config::OutcomeConfig};

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    #[account(
        has_one = authority,
        seeds = [b"outcome_config", outcome_config.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Account<'info, OutcomeConfig>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"outcome_vault", outcome_config.runtime_id.as_ref()],
        bump = outcome_config.vault_bump
    )]
    /// CHECK: vault PDA authority is enforced by seeds + signer derivation.
    pub outcome_vault: UncheckedAccount<'info>,
    /// CHECK: explicit admin flow allows withdrawing to any destination account.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AdminWithdraw>, lamports: u64) -> Result<()> {
    require!(lamports > 0, OutcomeError::InvalidInputAmount);

    let seeds: &[&[u8]] = &[
        b"outcome_vault",
        &ctx.accounts.outcome_config.runtime_id,
        &[ctx.accounts.outcome_config.vault_bump],
    ];
    let signer = &[seeds];
    let cpi_accounts = system_program::Transfer {
        from: ctx.accounts.outcome_vault.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    system_program::transfer(cpi_ctx, lamports)?;
    Ok(())
}
