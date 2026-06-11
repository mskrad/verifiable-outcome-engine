use anchor_lang::{prelude::*, system_program};

use crate::{
    errors::OutcomeError,
    events::RngV2ExpiredSealed,
    instructions::prepare_rng_v2::{
        RngV2State, RNG_V2_STATUS_EXPIRED_SEALED, RNG_V2_STATUS_SEALED,
    },
    state::{outcome_config::OutcomeConfig, program_config::ProgramConfig},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ExpireSealedRngV2Args {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
}

/// Expire a SEALED draw whose operator never attested within the deadline.
/// Permissionless after attest_deadline_slot. The bounty was already paid to the
/// sealer in phase 1, so by default the stake is simply refunded to the operator.
/// If `slash_on_sealed_timeout` is set on the runtime config, the stake is slashed
/// to the protocol treasury instead. Randomness stays on-chain forever for audit.
#[derive(Accounts)]
#[instruction(args: ExpireSealedRngV2Args)]
pub struct ExpireSealedRngV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
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
    /// CHECK: receives the stake refund; must equal rng_v2_state.actor.
    #[account(mut, address = rng_v2_state.actor @ OutcomeError::InvalidRngV2State)]
    pub operator: UncheckedAccount<'info>,
    /// CHECK: receives a slashed stake when slash_on_sealed_timeout is set; PATCH v3.1:
    /// protocol-global ProgramConfig.treasury, not the operator-controlled outcome_config.treasury.
    #[account(mut, address = program_config.treasury @ OutcomeError::InvalidTreasuryAccount)]
    pub protocol_treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExpireSealedRngV2>, args: ExpireSealedRngV2Args) -> Result<()> {
    let slash = ctx.accounts.outcome_config.slash_on_sealed_timeout;
    let vault_bump = ctx.accounts.outcome_config.vault_bump;

    let state = &mut ctx.accounts.rng_v2_state;
    require!(
        state.status == RNG_V2_STATUS_SEALED,
        OutcomeError::InvalidRngV2Status
    );
    require!(
        state.runtime_id == args.runtime_id && state.resolve_id == args.resolve_id,
        OutcomeError::InvalidRngV2State
    );
    let clock = Clock::get()?;
    require!(
        clock.slot > state.attest_deadline_slot,
        OutcomeError::RngV2AttestDeadlineNotReached
    );

    let recipient = if slash {
        ctx.accounts.protocol_treasury.to_account_info()
    } else {
        ctx.accounts.operator.to_account_info()
    };
    if state.input_lamports > 0 {
        let seeds: &[&[u8]] = &[b"outcome_vault", &state.runtime_id, &[vault_bump]];
        let signer = &[seeds];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.outcome_vault.to_account_info(),
                    to: recipient,
                },
                signer,
            ),
            state.input_lamports,
        )?;
    }

    state.status = RNG_V2_STATUS_EXPIRED_SEALED;

    emit!(RngV2ExpiredSealed {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        actor: state.actor,
        input_lamports_refunded: if slash { 0 } else { state.input_lamports },
        input_lamports_slashed: if slash { state.input_lamports } else { 0 },
        expired_at_slot: clock.slot,
    });

    Ok(())
}
