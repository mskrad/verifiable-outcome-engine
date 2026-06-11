use anchor_lang::{prelude::*, solana_program::sysvar};

use crate::{
    errors::OutcomeError,
    events::{OutcomeResolveStartedV1, RngV2Sealed},
    instructions::prepare_rng_v2::{RngV2State, RNG_V2_STATUS_PREPARED, RNG_V2_STATUS_SEALED},
    math::rng_v2,
    state::outcome_config::OutcomeConfig,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SealRandomnessArgs {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
}

/// Phase 1 of the v1.3.2 two-phase settle. Permissionless: anyone may seal the
/// randomness once the target window opens. No winner fields, no operator reveal —
/// the outcome is *determined* the moment this lands. The sealer is paid the bounty.
#[derive(Accounts)]
#[instruction(args: SealRandomnessArgs)]
pub struct SealRandomness<'info> {
    #[account(mut)]
    pub sealer: Signer<'info>,
    #[account(
        seeds = [b"outcome_config", args.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Box<Account<'info, OutcomeConfig>>,
    #[account(
        mut,
        seeds = [b"rng_v2_state", args.runtime_id.as_ref(), &args.resolve_id.to_le_bytes()],
        bump = rng_v2_state.bump
    )]
    pub rng_v2_state: Box<Account<'info, RngV2State>>,
    /// CHECK: validated manually as the SlotHashes sysvar account.
    pub slot_hashes: AccountInfo<'info>,
}

pub fn handler(ctx: Context<SealRandomness>, args: SealRandomnessArgs) -> Result<()> {
    // PATCH v3.1 lifecycle isolation: an open draw depends only on its frozen RngV2State
    // and protocol-global config — never on mutable OutcomeConfig (pause / artifact hash).
    // No is_paused gate (pause blocks new prepare only, not sealing an open draw) and no
    // bind to outcome_config.compiled_artifact_hash (seal reads no blob; a config artifact
    // rotation must not be able to abort an open draw).
    let state = &mut ctx.accounts.rng_v2_state;
    require!(
        state.status == RNG_V2_STATUS_PREPARED,
        OutcomeError::InvalidRngV2Status
    );
    require!(
        state.runtime_id == args.runtime_id && state.resolve_id == args.resolve_id,
        OutcomeError::InvalidRngV2State
    );

    let clock = Clock::get()?;
    require!(
        clock.slot > state.target_slots[2],
        OutcomeError::RngV2TargetSlotNotReady
    );
    require!(
        clock.slot <= state.expiry_slot,
        OutcomeError::RngV2SettlementWindowExpired
    );
    require_keys_eq!(
        ctx.accounts.slot_hashes.key(),
        sysvar::slot_hashes::ID,
        OutcomeError::InvalidSlotHashesSysvar
    );

    let slot_hashes_data = ctx.accounts.slot_hashes.try_borrow_data()?;
    let (resolved_slots, slot_hashes) =
        rng_v2::resolve_slot_hashes(&slot_hashes_data, &state.target_slots)?;
    drop(slot_hashes_data);
    state.resolved_slots = resolved_slots;
    state.slot_hashes = slot_hashes;

    // Randomness is fully determined here (operator reveal is NOT part of the seed —
    // it is recorded later at attest for audit only).
    let seed = rng_v2::derive_seed(
        &state.runtime_id,
        state.resolve_id,
        &state.compiled_artifact_hash,
        &state.snapshot_hash,
        &state.resolved_slots,
        &state.slot_hashes,
        state.operator_commit_present,
        &state.operator_commit_hash,
    );
    let randomness =
        rng_v2::derive_randomness(&seed, &state.runtime_id, state.resolve_id, &state.actor);

    // Pay the bounty to the sealer via a direct lamport debit from the program-owned PDA.
    let bounty = state.bounty_lamports;
    if bounty > 0 {
        let state_info = state.to_account_info();
        let sealer_info = ctx.accounts.sealer.to_account_info();
        let mut state_lamports = state_info.try_borrow_mut_lamports()?;
        let mut sealer_lamports = sealer_info.try_borrow_mut_lamports()?;
        **state_lamports = state_lamports
            .checked_sub(bounty)
            .ok_or(OutcomeError::MathOverflow)?;
        **sealer_lamports = sealer_lamports
            .checked_add(bounty)
            .ok_or(OutcomeError::MathOverflow)?;
    }

    state.status = RNG_V2_STATUS_SEALED;

    emit!(OutcomeResolveStartedV1 {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        actor: state.actor,
        input_lamports: state.input_lamports,
    });
    emit!(RngV2Sealed {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        sealer: ctx.accounts.sealer.key(),
        actor: state.actor,
        randomness,
        resolved_slots: state.resolved_slots,
        slot_hashes: state.slot_hashes,
        bounty_lamports: bounty,
        sealed_at_slot: clock.slot,
    });

    Ok(())
}
