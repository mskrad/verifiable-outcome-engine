use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    events::SortitionTicketClosed,
    state::{
        program_config::ProgramConfig,
        sortition::{SortitionDraw, TicketCommit, SORTITION_FEE_CLOSE_SKIM},
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CloseSortitionTicketArgs {
    pub draw_id: [u8; 16],
    pub ticket_id: [u8; 16],
}

/// Reclaim a ticket's rent after the claim window. Refund goes to the ticket
/// owner minus the draw's close-skim to the protocol treasury. Permissionless:
/// owner OR a keeper may call (the caller never receives funds — anti-grief).
/// The skim is read from the mandatory `SortitionDraw`, so it cannot be dodged
/// by omitting an account.
#[derive(Accounts)]
#[instruction(args: CloseSortitionTicketArgs)]
pub struct CloseSortitionTicket<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        seeds = [b"sortition_draw", args.draw_id.as_ref()],
        bump = sortition_draw.bump
    )]
    pub sortition_draw: Account<'info, SortitionDraw>,
    #[account(
        mut,
        close = owner,
        seeds = [b"sortition_ticket", args.draw_id.as_ref(), args.ticket_id.as_ref()],
        bump = ticket_commit.bump,
        constraint = ticket_commit.draw_id == args.draw_id
            && ticket_commit.ticket_id == args.ticket_id @ OutcomeError::InvalidSortitionTicket,
    )]
    pub ticket_commit: Account<'info, TicketCommit>,
    /// CHECK: receives the rent refund (minus skim); must equal ticket_commit.owner.
    #[account(mut, address = ticket_commit.owner @ OutcomeError::Unauthorized)]
    pub owner: UncheckedAccount<'info>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    /// CHECK: receives the close skim; must equal program_config.treasury.
    #[account(mut, address = program_config.treasury @ OutcomeError::InvalidTreasuryAccount)]
    pub treasury: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CloseSortitionTicket>, args: CloseSortitionTicketArgs) -> Result<()> {
    let clock = Clock::get()?;
    let draw = &ctx.accounts.sortition_draw;
    require!(draw.draw_id == args.draw_id, OutcomeError::InvalidSortitionDraw);
    require!(
        clock.slot > draw.claim_deadline,
        OutcomeError::SortitionCloseTooEarly
    );

    let skim_bps: u64 = if draw.fee_mode & SORTITION_FEE_CLOSE_SKIM != 0 {
        draw.close_skim_bps as u64
    } else {
        0
    };

    let ticket_ai = ctx.accounts.ticket_commit.to_account_info();
    let rent = ticket_ai.lamports();
    let skim = (rent as u128)
        .checked_mul(skim_bps as u128)
        .ok_or(OutcomeError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(OutcomeError::MathOverflow)? as u64;

    // Manually skim to treasury; Anchor `close = owner` transfers the remainder
    // (rent - skim) to the owner and zeroes the account on exit.
    if skim > 0 {
        **ticket_ai.try_borrow_mut_lamports()? -= skim;
        **ctx.accounts.treasury.try_borrow_mut_lamports()? += skim;
    }

    emit!(SortitionTicketClosed {
        draw_id: args.draw_id,
        ticket_id: args.ticket_id,
        owner: ctx.accounts.owner.key(),
        refunded_lamports: rent - skim,
        skim_lamports: skim,
    });

    Ok(())
}
