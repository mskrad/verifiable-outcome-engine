use anchor_lang::{prelude::*, solana_program::sysvar};
use crate::math::sha::Sha256;

use crate::{
    errors::OutcomeError,
    events::SortitionSealed,
    math::rng_v2,
    state::sortition::{SortitionDraw, SORTITION_STATUS_REGISTERING, SORTITION_STATUS_SEALED},
};

pub const SORTITION_V14_DOMAIN: &[u8] = b"VRE_SORTITION_V1_4_0";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SealSortitionDrawArgs {
    pub draw_id: [u8; 16],
}

#[derive(Accounts)]
#[instruction(args: SealSortitionDrawArgs)]
pub struct SealSortitionDraw<'info> {
    #[account(mut)]
    pub sealer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"sortition_draw", args.draw_id.as_ref()],
        bump = sortition_draw.bump
    )]
    pub sortition_draw: Account<'info, SortitionDraw>,
    /// CHECK: validated manually as the SlotHashes sysvar account.
    pub slot_hashes: AccountInfo<'info>,
}

pub fn derive_sortition_omega(
    draw_id: &[u8; 16],
    registration_snapshot_hash: &[u8; 32],
    resolved_slots: &[u64; 3],
    slot_hashes: &[[u8; 32]; 3],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(SORTITION_V14_DOMAIN);
    hasher.update(draw_id);
    hasher.update(registration_snapshot_hash);
    for index in 0..3 {
        hasher.update(resolved_slots[index].to_le_bytes());
        hasher.update(slot_hashes[index]);
    }
    hasher.finalize().into()
}

pub fn handler(ctx: Context<SealSortitionDraw>, args: SealSortitionDrawArgs) -> Result<()> {
    let draw = &mut ctx.accounts.sortition_draw;
    require!(
        draw.status == SORTITION_STATUS_REGISTERING,
        OutcomeError::InvalidSortitionStatus
    );
    require!(draw.draw_id == args.draw_id, OutcomeError::InvalidSortitionDraw);

    let clock = Clock::get()?;
    require!(
        clock.slot > draw.registration_deadline,
        OutcomeError::SortitionRegistrationOpen
    );
    require!(
        clock.slot > draw.target_slots[2],
        OutcomeError::RngV2TargetSlotNotReady
    );
    require!(
        clock.slot <= draw.expiry_slot,
        OutcomeError::RngV2SettlementWindowExpired
    );
    require_keys_eq!(
        ctx.accounts.slot_hashes.key(),
        sysvar::slot_hashes::ID,
        OutcomeError::InvalidSlotHashesSysvar
    );

    let slot_hashes_data = ctx.accounts.slot_hashes.try_borrow_data()?;
    let (resolved_slots, slot_hashes) =
        rng_v2::resolve_slot_hashes(&slot_hashes_data, &draw.target_slots)?;
    drop(slot_hashes_data);

    draw.resolved_slots = resolved_slots;
    draw.slot_hashes = slot_hashes;
    draw.omega = derive_sortition_omega(
        &draw.draw_id,
        &draw.registration_snapshot_hash,
        &draw.resolved_slots,
        &draw.slot_hashes,
    );
    draw.status = SORTITION_STATUS_SEALED;

    emit!(SortitionSealed {
        draw_id: draw.draw_id,
        sealer: ctx.accounts.sealer.key(),
        omega: draw.omega,
        resolved_slots: draw.resolved_slots,
        slot_hashes: draw.slot_hashes,
        registration_snapshot_hash: draw.registration_snapshot_hash,
        sealed_at_slot: clock.slot,
    });

    Ok(())
}
