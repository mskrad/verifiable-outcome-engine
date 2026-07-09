use anchor_lang::prelude::*;

#[account]
pub struct ProgramConfig {
    pub admin: Pubkey,                  // 32
    pub allow_unreviewed_binding: bool, // 1
    pub bump: u8,                       // 1
    pub fee_lamports: u64,              // 8  ← protocol fee per resolve (0 = disabled)
    pub treasury: Pubkey,               // 32 ← recipient of protocol fee
    pub reserved: [u8; 22],             // 22 (was 62)
}

impl ProgramConfig {
    pub const LEN: usize = 8 + 32 + 1 + 1 + 8 + 32 + 22; // = 104
}
