use anchor_lang::prelude::*;

#[account]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub allow_unreviewed_binding: bool,
    pub bump: u8,
    pub reserved: [u8; 62],
}

impl ProgramConfig {
    pub const LEN: usize = 8 + 32 + 1 + 1 + 62;
}
