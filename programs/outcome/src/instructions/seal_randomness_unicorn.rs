use anchor_lang::{prelude::*, solana_program::sysvar};

use crate::{
    errors::OutcomeError,
    events::{OutcomeResolveStartedV1, RngV2Sealed, RngV2UnicornSealed},
    instructions::prepare_rng_v2::{RngV2State, RNG_V2_STATUS_PREPARED, RNG_V2_STATUS_SEALED},
    math::{rng_v2, unicorn_g},
    state::{
        outcome_config::OutcomeConfig,
        unicorn_g::{UnicornGConfig, UNICORN_G_DEVNET_RSA_MODULUS_ID},
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SealRandomnessUnicornArgs {
    pub runtime_id: [u8; 16],
    pub resolve_id: u64,
    pub y: [u64; 32],
    pub proof_a_neg: [u8; 64],
    pub proof_b: [u8; 128],
    pub proof_c: [u8; 64],
}

#[derive(Accounts)]
#[instruction(args: SealRandomnessUnicornArgs)]
pub struct SealRandomnessUnicorn<'info> {
    #[account(mut)]
    pub sealer: Signer<'info>,
    #[account(
        seeds = [b"outcome_config", args.runtime_id.as_ref()],
        bump = outcome_config.bump
    )]
    pub outcome_config: Box<Account<'info, OutcomeConfig>>,
    #[account(
        seeds = [b"unicorn_g_config"],
        bump = unicorn_g_config.bump
    )]
    pub unicorn_g_config: Box<Account<'info, UnicornGConfig>>,
    #[account(
        mut,
        seeds = [b"rng_v2_state", args.runtime_id.as_ref(), &args.resolve_id.to_le_bytes()],
        bump = rng_v2_state.bump
    )]
    pub rng_v2_state: Box<Account<'info, RngV2State>>,
    /// CHECK: validated manually as the SlotHashes sysvar account.
    pub slot_hashes: AccountInfo<'info>,
}

pub fn handler(ctx: Context<SealRandomnessUnicorn>, args: SealRandomnessUnicornArgs) -> Result<()> {
    let unicorn_config = &ctx.accounts.unicorn_g_config;
    require!(unicorn_config.enabled, OutcomeError::InvalidUnicornGConfig);
    require!(
        unicorn_config.rsa_modulus_id == UNICORN_G_DEVNET_RSA_MODULUS_ID,
        OutcomeError::InvalidUnicornGConfig
    );

    let state = &mut ctx.accounts.rng_v2_state;
    require!(
        state.status == RNG_V2_STATUS_PREPARED,
        OutcomeError::InvalidRngV2Status
    );
    require!(
        state.runtime_id == args.runtime_id && state.resolve_id == args.resolve_id,
        OutcomeError::InvalidRngV2State
    );
    require!(
        state.entropy_source == unicorn_g::ENTROPY_SOURCE_UNICORN_G,
        OutcomeError::InvalidEntropySource
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

    let seed = rng_v2::derive_seed(
        &state.runtime_id,
        state.resolve_id,
        &state.compiled_artifact_hash,
        &state.snapshot_hash,
        &resolved_slots,
        &slot_hashes,
        state.operator_commit_present,
        &state.operator_commit_hash,
    );
    let u = unicorn_g::derive_u_from_seed(&seed);

    let commit = unicorn_g::commit(&u, &args.y);
    unicorn_g::verify_unicorn_proof(commit, &args.proof_a_neg, &args.proof_b, &args.proof_c)?;

    let u_hash = unicorn_g::hash_limb_bytes(&u);
    let y_hash = unicorn_g::hash_limb_bytes(&args.y);
    let randomness =
        unicorn_g::derive_randomness(&args.y, &state.runtime_id, state.resolve_id, &state.actor);

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

    state.resolved_slots = resolved_slots;
    // Unicorn-G evidence slots without increasing account size:
    // [0]=commit, [1]=y_hash, [2]=randomness. The u_hash is emitted for replay.
    state.slot_hashes = [commit, y_hash, randomness];
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
        entropy_source: state.entropy_source,
    });
    emit!(RngV2UnicornSealed {
        runtime_id: state.runtime_id,
        resolve_id: state.resolve_id,
        sealer: ctx.accounts.sealer.key(),
        actor: state.actor,
        resolved_slots,
        resolved_slot_hashes: slot_hashes,
        commit,
        u_hash,
        y_hash,
        randomness,
        bounty_lamports: bounty,
        sealed_at_slot: clock.slot,
    });

    Ok(())
}
