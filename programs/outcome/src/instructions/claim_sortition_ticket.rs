use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::{
    errors::OutcomeError,
    events::SortitionClaimed,
    state::sortition::{SortitionDraw, TicketCommit, SORTITION_STATUS_SEALED},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClaimSortitionTicketArgs {
    pub draw_id: [u8; 16],
    pub ticket_id: [u8; 16],
    pub secret: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: ClaimSortitionTicketArgs)]
pub struct ClaimSortitionTicket<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(
        mut,
        seeds = [b"sortition_draw", args.draw_id.as_ref()],
        bump = sortition_draw.bump
    )]
    pub sortition_draw: Account<'info, SortitionDraw>,
    #[account(
        mut,
        seeds = [b"sortition_ticket", args.draw_id.as_ref(), args.ticket_id.as_ref()],
        bump = ticket_commit.bump
    )]
    pub ticket_commit: Account<'info, TicketCommit>,
}

fn derive_commitment(secret: &[u8; 32], ticket_id: &[u8; 16], draw_id: &[u8; 16]) -> [u8; 32] {
    hashv(&[secret.as_ref(), ticket_id.as_ref(), draw_id.as_ref()]).to_bytes()
}

fn derive_predicate_digest(secret: &[u8; 32], omega: &[u8; 32]) -> [u8; 32] {
    hashv(&[secret.as_ref(), omega.as_ref()]).to_bytes()
}

fn bytes_less_than(left: &[u8; 32], right: &[u8; 32]) -> bool {
    for index in 0..32 {
        if left[index] < right[index] {
            return true;
        }
        if left[index] > right[index] {
            return false;
        }
    }
    false
}

pub fn handler(ctx: Context<ClaimSortitionTicket>, args: ClaimSortitionTicketArgs) -> Result<()> {
    let clock = Clock::get()?;
    let draw = &mut ctx.accounts.sortition_draw;
    let ticket = &mut ctx.accounts.ticket_commit;

    require!(draw.draw_id == args.draw_id, OutcomeError::InvalidSortitionDraw);
    require!(
        draw.status == SORTITION_STATUS_SEALED,
        OutcomeError::InvalidSortitionStatus
    );
    require!(
        clock.slot <= draw.claim_deadline,
        OutcomeError::SortitionClaimWindowClosed
    );
    require!(
        ticket.draw_id == args.draw_id && ticket.ticket_id == args.ticket_id,
        OutcomeError::InvalidSortitionTicket
    );
    require_keys_eq!(
        ticket.owner,
        ctx.accounts.participant.key(),
        OutcomeError::Unauthorized
    );
    require!(!ticket.claimed, OutcomeError::SortitionAlreadyClaimed);

    let commitment = derive_commitment(&args.secret, &args.ticket_id, &args.draw_id);
    require!(
        commitment == ticket.commitment,
        OutcomeError::InvalidSortitionSecret
    );

    let predicate_digest = derive_predicate_digest(&args.secret, &draw.omega);
    require!(
        bytes_less_than(&predicate_digest, &draw.threshold),
        OutcomeError::SortitionPredicateNotMet
    );

    ticket.claimed = true;
    draw.winners_count = draw
        .winners_count
        .checked_add(1)
        .ok_or(OutcomeError::MathOverflow)?;

    emit!(SortitionClaimed {
        draw_id: args.draw_id,
        ticket_id: args.ticket_id,
        owner: ticket.owner,
        omega: draw.omega,
        predicate_digest,
        winners_count: draw.winners_count,
    });

    Ok(())
}
