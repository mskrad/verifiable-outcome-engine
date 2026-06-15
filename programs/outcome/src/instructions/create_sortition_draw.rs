use anchor_lang::prelude::*;

use crate::{
    errors::OutcomeError,
    events::SortitionDrawCreated,
    math::rng_v2,
    state::sortition::{
        SortitionDraw, SORTITION_STANDARD_VERSION, SORTITION_STATUS_REGISTERING,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateSortitionDrawArgs {
    pub draw_id: [u8; 16],
    pub threshold: [u8; 32],
    pub registration_duration_slots: u64,
    pub claim_duration_slots: u64,
    pub unclaimed_rule: u8,
}

#[derive(Accounts)]
#[instruction(args: CreateSortitionDrawArgs)]
pub struct CreateSortitionDraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = SortitionDraw::LEN,
        seeds = [b"sortition_draw", args.draw_id.as_ref()],
        bump
    )]
    pub sortition_draw: Account<'info, SortitionDraw>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateSortitionDraw>, args: CreateSortitionDrawArgs) -> Result<()> {
    require!(
        args.registration_duration_slots > 0,
        OutcomeError::InvalidSortitionWindow
    );
    require!(
        args.registration_duration_slots < rng_v2::RNG_V2_TARGET_OFFSETS[0],
        OutcomeError::InvalidSortitionWindow
    );
    require!(
        args.claim_duration_slots > 0,
        OutcomeError::InvalidSortitionWindow
    );
    require!(
        args.threshold.iter().any(|byte| *byte != 0),
        OutcomeError::InvalidSortitionThreshold
    );

    let clock = Clock::get()?;
    let (target_slots, expiry_slot) = rng_v2::derive_target_slots(clock.slot)?;
    let registration_deadline = clock
        .slot
        .checked_add(args.registration_duration_slots)
        .ok_or(OutcomeError::MathOverflow)?;
    let claim_deadline = target_slots[2]
        .checked_add(args.claim_duration_slots)
        .ok_or(OutcomeError::MathOverflow)?;

    let draw = &mut ctx.accounts.sortition_draw;
    draw.draw_id = args.draw_id;
    draw.authority = ctx.accounts.authority.key();
    draw.standard_version = SORTITION_STANDARD_VERSION;
    draw.threshold = args.threshold;
    draw.target_slots = target_slots;
    draw.registration_deadline = registration_deadline;
    draw.expiry_slot = expiry_slot;
    draw.registration_snapshot_hash = [0u8; 32];
    draw.status = SORTITION_STATUS_REGISTERING;
    draw.omega = [0u8; 32];
    draw.resolved_slots = [0u64; 3];
    draw.slot_hashes = [[0u8; 32]; 3];
    draw.claim_deadline = claim_deadline;
    draw.winners_count = 0;
    draw.unclaimed_rule = args.unclaimed_rule;
    draw.bump = ctx.bumps.sortition_draw;
    draw.reserved = [0u8; crate::state::sortition::SORTITION_RESERVED_BYTES];

    emit!(SortitionDrawCreated {
        draw_id: draw.draw_id,
        authority: draw.authority,
        standard_version: draw.standard_version,
        threshold: draw.threshold,
        target_slots: draw.target_slots,
        registration_deadline: draw.registration_deadline,
        claim_deadline: draw.claim_deadline,
        unclaimed_rule: draw.unclaimed_rule,
    });

    Ok(())
}
