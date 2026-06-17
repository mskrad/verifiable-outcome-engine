use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    events::SortitionEconomicsInitialized,
    state::sortition::{
        SortitionDraw, SORTITION_FEE_ALL, SORTITION_FEE_CLOSE_SKIM, SORTITION_FEE_ENTRY,
        SORTITION_STATUS_REGISTERING,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitSortitionEconomicsArgs {
    pub draw_id: [u8; 16],
    pub fee_mode: u8,
    pub entry_fee_lamports: u64,
    pub close_skim_bps: u16,
}

/// Enable economics on a draw. Enforcement-critical fields live on the mandatory
/// `SortitionDraw` account (not an optional/companion one) so they cannot be
/// bypassed by omitting an account or calling a fee-free instruction. Set once,
/// during registration, by the draw authority → immutable thereafter.
#[derive(Accounts)]
#[instruction(args: InitSortitionEconomicsArgs)]
pub struct InitSortitionEconomics<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"sortition_draw", args.draw_id.as_ref()],
        bump = sortition_draw.bump,
        constraint = sortition_draw.authority == authority.key() @ OutcomeError::Unauthorized,
    )]
    pub sortition_draw: Account<'info, SortitionDraw>,
}

pub fn handler(
    ctx: Context<InitSortitionEconomics>,
    args: InitSortitionEconomicsArgs,
) -> Result<()> {
    let draw = &mut ctx.accounts.sortition_draw;
    require!(draw.draw_id == args.draw_id, OutcomeError::InvalidSortitionDraw);
    require!(
        draw.status == SORTITION_STATUS_REGISTERING,
        OutcomeError::InvalidSortitionStatus
    );
    // Economics must be fixed BEFORE anyone registers — otherwise an operator could
    // bait participants with a free draw, then retroactively impose close_skim on
    // their already-deposited rent. registration_snapshot_hash is zero until the
    // first registration folds into it. Operators must issue create + this ix in one
    // atomic tx to avoid a front-run that bricks economics on the draw.
    require!(
        draw.registration_snapshot_hash == [0u8; 32],
        OutcomeError::SortitionEconomicsAfterRegistration
    );
    // Set once: refuse if economics already enabled (immutability / anti admin-raise).
    require!(draw.fee_mode == 0, OutcomeError::SortitionEconomicsAlreadySet);
    // Reject unknown fee_mode bits to catch client mistakes.
    require!(
        args.fee_mode != 0 && args.fee_mode & !SORTITION_FEE_ALL == 0,
        OutcomeError::InvalidSortitionConfig
    );
    require!(args.close_skim_bps <= 10_000, OutcomeError::InvalidSkimBps);
    if args.fee_mode & SORTITION_FEE_ENTRY != 0 {
        require!(args.entry_fee_lamports > 0, OutcomeError::InvalidEntryFee);
    }
    if args.fee_mode & SORTITION_FEE_CLOSE_SKIM != 0 {
        require!(args.close_skim_bps > 0, OutcomeError::InvalidSkimBps);
    }

    draw.fee_mode = args.fee_mode;
    draw.entry_fee_lamports = args.entry_fee_lamports;
    draw.close_skim_bps = args.close_skim_bps;

    emit!(SortitionEconomicsInitialized {
        draw_id: draw.draw_id,
        fee_mode: draw.fee_mode,
        entry_fee_lamports: draw.entry_fee_lamports,
        close_skim_bps: draw.close_skim_bps,
    });

    Ok(())
}
