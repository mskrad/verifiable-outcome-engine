use anchor_lang::{prelude::*, system_program};

use crate::{
    errors::OutcomeError,
    events::RngV2Expired,
    instructions::prepare_rng_v2::{RngV2State, RNG_V2_STATUS_EXPIRED, RNG_V2_STATUS_PREPARED},
    state::outcome_config::OutcomeConfig,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ExpireRngV2Args {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
}

#[derive(Accounts)]
#[instruction(args: ExpireRngV2Args)]
pub struct ExpireRngV2<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [b"outcome_config", args.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Account<'info, OutcomeConfig>,
    #[account(
        mut,
        seeds = [b"outcome_vault", args.runtime_id.as_ref()],
        bump = outcome_config.vault_bump
    )]
    pub outcome_vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [b"rng_v2_state", args.runtime_id.as_ref(), &args.resolve_id.to_le_bytes()],
        bump = rng_v2_state.bump
    )]
    pub rng_v2_state: Account<'info, RngV2State>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExpireRngV2>, args: ExpireRngV2Args) -> Result<()> {
    let state = &mut ctx.accounts.rng_v2_state;
    require!(
        state.status == RNG_V2_STATUS_PREPARED,
        OutcomeError::InvalidRngV2Status
    );
    require!(
        state.runtime_id == args.runtime_id
            && state.resolve_id == args.resolve_id
            && state.actor == ctx.accounts.actor.key(),
        OutcomeError::InvalidRngV2State
    );
    let clock = Clock::get()?;
    require!(
        clock.slot > state.expiry_slot,
        OutcomeError::RngV2TargetSlotNotReady
    );

    let seeds: &[&[u8]] = &[
        b"outcome_vault",
        &state.runtime_id,
        &[ctx.accounts.outcome_config.vault_bump],
    ];
    let signer = &[seeds];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.outcome_vault.to_account_info(),
                to: ctx.accounts.actor.to_account_info(),
            },
            signer,
        ),
        state.input_lamports,
    )?;

    state.status = RNG_V2_STATUS_EXPIRED;

    emit!(RngV2Expired {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        actor: state.actor,
        input_lamports_refunded: state.input_lamports,
        expired_at_slot: clock.slot,
    });

    Ok(())
}
