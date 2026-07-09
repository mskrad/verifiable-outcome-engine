use anchor_lang::prelude::*;

use crate::errors::OutcomeError;

#[account]
pub struct OutcomeConfig {
    pub runtime_id: [u8; 16],
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub min_input_lamports: u64,
    pub max_input_lamports: u64,
    pub next_resolve_id: u64,
    pub is_paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
    pub compiled_artifact_hash: [u8; 32],
    pub master_seed: [u8; 32],
    pub last_seed_slot: u64,
    // --- Outcome Standard v1.3.2 (Tier 0) additive fields, carved from reserved ---
    pub attester_key: Pubkey, // 32 — allowlisted attester (default zero = operator-only)
    pub bounty_min: u64,      // 8  — minimum bounty required at prepare
    pub slash_on_sealed_timeout: bool, // 1  — slash stake instead of refunding on expire_sealed (default off)
    pub reserved: [u8; 22],
}

impl OutcomeConfig {
    pub const LEN: usize = 8 + 16 + 32 + 32 + 8 + 8 + 8 + 1 + 1 + 1 + 32 + 32 + 8 + 32 + 8 + 1 + 22;

    pub fn assert_input_in_range(&self, input_lamports: u64) -> Result<()> {
        require!(
            input_lamports >= self.min_input_lamports,
            OutcomeError::InvalidInputAmount
        );
        require!(
            input_lamports <= self.max_input_lamports,
            OutcomeError::InvalidInputAmount
        );
        Ok(())
    }
}
