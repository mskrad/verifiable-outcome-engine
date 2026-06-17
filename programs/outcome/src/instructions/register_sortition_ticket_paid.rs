use anchor_lang::{prelude::*, system_program};

use crate::{
    errors::OutcomeError,
    events::{SortitionEntryFeePaid, SortitionRegistered},
    instructions::register_sortition_ticket::{update_snapshot_hash, RegisterSortitionTicketArgs},
    state::{
        program_config::ProgramConfig,
        sortition::{SortitionDraw, TicketCommit, SORTITION_FEE_ENTRY, SORTITION_STATUS_REGISTERING},
    },
};

/// Register a ticket and pay the draw's entry fee (if any) to the protocol-global
/// treasury. The fee comes from the mandatory `SortitionDraw` account, so it
/// cannot be dodged. Draws with an entry fee force this path (the free
/// `register_sortition_ticket` rejects them).
#[derive(Accounts)]
#[instruction(args: RegisterSortitionTicketArgs)]
pub struct RegisterSortitionTicketPaid<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(
        mut,
        seeds = [b"sortition_draw", args.draw_id.as_ref()],
        bump = sortition_draw.bump
    )]
    pub sortition_draw: Account<'info, SortitionDraw>,
    #[account(
        init,
        payer = participant,
        space = TicketCommit::LEN,
        seeds = [b"sortition_ticket", args.draw_id.as_ref(), args.ticket_id.as_ref()],
        bump
    )]
    pub ticket_commit: Account<'info, TicketCommit>,
    #[account(
        seeds = [b"outcome_program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    /// CHECK: receives the entry fee; must equal program_config.treasury.
    #[account(mut, address = program_config.treasury @ OutcomeError::InvalidTreasuryAccount)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterSortitionTicketPaid>,
    args: RegisterSortitionTicketArgs,
) -> Result<()> {
    require!(
        args.commitment.iter().any(|byte| *byte != 0),
        OutcomeError::InvalidSortitionCommitment
    );

    let clock = Clock::get()?;
    let (fee, draw_id_ok) = {
        let draw = &ctx.accounts.sortition_draw;
        require!(
            draw.status == SORTITION_STATUS_REGISTERING,
            OutcomeError::InvalidSortitionStatus
        );
        require!(
            clock.slot <= draw.registration_deadline,
            OutcomeError::SortitionRegistrationClosed
        );
        let fee = if draw.fee_mode & SORTITION_FEE_ENTRY != 0 {
            draw.entry_fee_lamports
        } else {
            0
        };
        (fee, draw.draw_id == args.draw_id)
    };
    require!(draw_id_ok, OutcomeError::InvalidSortitionDraw);

    // Charge the entry fee first; on insufficient funds the whole tx (incl. the
    // ticket init) reverts.
    if fee > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.participant.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            fee,
        )?;
        emit!(SortitionEntryFeePaid {
            draw_id: args.draw_id,
            ticket_id: args.ticket_id,
            participant: ctx.accounts.participant.key(),
            fee_lamports: fee,
        });
    }

    let ticket = &mut ctx.accounts.ticket_commit;
    ticket.draw_id = args.draw_id;
    ticket.ticket_id = args.ticket_id;
    ticket.owner = ctx.accounts.participant.key();
    ticket.commitment = args.commitment;
    ticket.claimed = false;
    ticket.bump = ctx.bumps.ticket_commit;
    ticket.reserved = [0u8; crate::state::sortition::TICKET_RESERVED_BYTES];

    let owner = ticket.owner;
    let commitment = ticket.commitment;

    let draw = &mut ctx.accounts.sortition_draw;
    draw.registration_snapshot_hash = update_snapshot_hash(
        &draw.registration_snapshot_hash,
        &args.ticket_id,
        &owner,
        &commitment,
    );

    emit!(SortitionRegistered {
        draw_id: args.draw_id,
        ticket_id: args.ticket_id,
        owner,
        commitment,
        registration_snapshot_hash: draw.registration_snapshot_hash,
    });

    Ok(())
}
