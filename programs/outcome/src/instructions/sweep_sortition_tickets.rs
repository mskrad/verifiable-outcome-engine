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
pub struct SweepSortitionTicketsArgs {
    pub draw_id: [u8; 16],
}

/// Batch variant of `close_sortition_ticket`: closes many tickets of one draw in
/// a single transaction to amortize the keeper's per-tx fee. `remaining_accounts`
/// is a flat list of `[ticket_commit, owner]` pairs (both writable). Permissionless;
/// the caller never receives funds — refund goes to each ticket owner minus skim.
#[derive(Accounts)]
#[instruction(args: SweepSortitionTicketsArgs)]
pub struct SweepSortitionTickets<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        seeds = [b"sortition_draw", args.draw_id.as_ref()],
        bump = sortition_draw.bump
    )]
    pub sortition_draw: Account<'info, SortitionDraw>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    /// CHECK: receives the close skim; must equal program_config.treasury.
    #[account(mut, address = program_config.treasury @ OutcomeError::InvalidTreasuryAccount)]
    pub treasury: UncheckedAccount<'info>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, SweepSortitionTickets<'info>>,
    args: SweepSortitionTicketsArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        ctx.accounts.sortition_draw.draw_id == args.draw_id,
        OutcomeError::InvalidSortitionDraw
    );
    require!(
        clock.slot > ctx.accounts.sortition_draw.claim_deadline,
        OutcomeError::SortitionCloseTooEarly
    );

    let skim_bps: u64 = if ctx.accounts.sortition_draw.fee_mode & SORTITION_FEE_CLOSE_SKIM != 0 {
        ctx.accounts.sortition_draw.close_skim_bps as u64
    } else {
        0
    };

    let treasury_ai = ctx.accounts.treasury.to_account_info();
    let mut accounts = ctx.remaining_accounts.iter();

    while let Some(ticket_ai) = accounts.next() {
        let owner_ai = accounts
            .next()
            .ok_or(OutcomeError::InvalidSortitionTicket)?;

        // Validate the untrusted ticket account: program-owned, correct type,
        // canonical PDA for this draw, and the paired owner matches.
        let (ticket_id, owner_key) = {
            let ticket: Account<TicketCommit> = Account::try_from(ticket_ai)?;
            require!(
                ticket.draw_id == args.draw_id,
                OutcomeError::InvalidSortitionTicket
            );
            (ticket.ticket_id, ticket.owner)
        };
        let (expected, _bump) = Pubkey::find_program_address(
            &[b"sortition_ticket", args.draw_id.as_ref(), ticket_id.as_ref()],
            ctx.program_id,
        );
        require!(
            ticket_ai.key() == expected,
            OutcomeError::InvalidSortitionTicket
        );
        require!(owner_ai.key() == owner_key, OutcomeError::Unauthorized);

        let rent = ticket_ai.lamports();
        let skim = (rent as u128)
            .checked_mul(skim_bps as u128)
            .ok_or(OutcomeError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(OutcomeError::MathOverflow)? as u64;
        let refund = rent - skim;

        // Manual close: drain the ticket, credit owner + treasury, zero the data
        // so the closed account cannot be reinterpreted within this transaction.
        **ticket_ai.try_borrow_mut_lamports()? = 0;
        let owner_lamports = owner_ai.lamports();
        **owner_ai.try_borrow_mut_lamports()? = owner_lamports
            .checked_add(refund)
            .ok_or(OutcomeError::MathOverflow)?;
        let treasury_lamports = treasury_ai.lamports();
        **treasury_ai.try_borrow_mut_lamports()? = treasury_lamports
            .checked_add(skim)
            .ok_or(OutcomeError::MathOverflow)?;
        {
            let mut data = ticket_ai.try_borrow_mut_data()?;
            for byte in data.iter_mut() {
                *byte = 0;
            }
        }

        emit!(SortitionTicketClosed {
            draw_id: args.draw_id,
            ticket_id,
            owner: owner_key,
            refunded_lamports: refund,
            skim_lamports: skim,
        });
    }

    Ok(())
}
