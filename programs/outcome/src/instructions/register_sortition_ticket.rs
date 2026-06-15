use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::{
    errors::OutcomeError,
    events::SortitionRegistered,
    state::sortition::{SortitionDraw, TicketCommit, SORTITION_STATUS_REGISTERING},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterSortitionTicketArgs {
    pub draw_id: [u8; 16],
    pub ticket_id: [u8; 16],
    pub commitment: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: RegisterSortitionTicketArgs)]
pub struct RegisterSortitionTicket<'info> {
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
    pub system_program: Program<'info, System>,
}

fn update_snapshot_hash(
    previous: &[u8; 32],
    ticket_id: &[u8; 16],
    owner: &Pubkey,
    commitment: &[u8; 32],
) -> [u8; 32] {
    hashv(&[
        previous.as_ref(),
        ticket_id.as_ref(),
        owner.as_ref(),
        commitment.as_ref(),
    ])
    .to_bytes()
}

pub fn handler(
    ctx: Context<RegisterSortitionTicket>,
    args: RegisterSortitionTicketArgs,
) -> Result<()> {
    require!(
        args.commitment.iter().any(|byte| *byte != 0),
        OutcomeError::InvalidSortitionCommitment
    );

    let clock = Clock::get()?;
    let draw = &mut ctx.accounts.sortition_draw;
    require!(
        draw.status == SORTITION_STATUS_REGISTERING,
        OutcomeError::InvalidSortitionStatus
    );
    require!(
        clock.slot <= draw.registration_deadline,
        OutcomeError::SortitionRegistrationClosed
    );

    let ticket = &mut ctx.accounts.ticket_commit;
    ticket.draw_id = args.draw_id;
    ticket.ticket_id = args.ticket_id;
    ticket.owner = ctx.accounts.participant.key();
    ticket.commitment = args.commitment;
    ticket.claimed = false;
    ticket.bump = ctx.bumps.ticket_commit;
    ticket.reserved = [0u8; crate::state::sortition::TICKET_RESERVED_BYTES];

    draw.registration_snapshot_hash = update_snapshot_hash(
        &draw.registration_snapshot_hash,
        &args.ticket_id,
        &ticket.owner,
        &ticket.commitment,
    );

    emit!(SortitionRegistered {
        draw_id: args.draw_id,
        ticket_id: args.ticket_id,
        owner: ticket.owner,
        commitment: ticket.commitment,
        registration_snapshot_hash: draw.registration_snapshot_hash,
    });

    Ok(())
}
