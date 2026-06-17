use anchor_lang::prelude::*;

pub const SORTITION_STATUS_REGISTERING: u8 = 1;
pub const SORTITION_STATUS_SEALED: u8 = 2;
pub const SORTITION_STATUS_CLOSED: u8 = 3;
pub const SORTITION_STANDARD_VERSION: [u8; 5] = *b"1.4.0";
// v1.4.1 (INFRA-013): 11 bytes carved from the original 31 reserved for economics
// (fee_mode + entry_fee_lamports + close_skim_bps). LEN unchanged → byte-compatible
// with draws created under 1.4.0 (those 11 bytes were zero = economics disabled).
pub const SORTITION_RESERVED_BYTES: usize = 20;
pub const TICKET_RESERVED_BYTES: usize = 30;

// fee_mode bitflags (stored on SortitionDraw; enforcement-critical → on the
// mandatory account, never an optional/companion one).
pub const SORTITION_FEE_ENTRY: u8 = 1 << 0; // flat entry fee at register
pub const SORTITION_FEE_CLOSE_SKIM: u8 = 1 << 1; // % of rent skimmed on close
pub const SORTITION_FEE_ALL: u8 = SORTITION_FEE_ENTRY | SORTITION_FEE_CLOSE_SKIM;

#[account]
pub struct SortitionDraw {
    pub draw_id: [u8; 16],
    pub authority: Pubkey,
    pub standard_version: [u8; 5],
    pub threshold: [u8; 32],
    pub target_slots: [u64; 3],
    pub registration_deadline: u64,
    pub expiry_slot: u64,
    pub registration_snapshot_hash: [u8; 32],
    pub status: u8,
    pub omega: [u8; 32],
    pub resolved_slots: [u64; 3],
    pub slot_hashes: [[u8; 32]; 3],
    pub claim_deadline: u64,
    pub winners_count: u64,
    pub unclaimed_rule: u8,
    pub bump: u8,
    // --- v1.4.1 economics (carved from reserved; 0 = disabled) ---
    pub fee_mode: u8,
    pub entry_fee_lamports: u64,
    pub close_skim_bps: u16,
    pub reserved: [u8; SORTITION_RESERVED_BYTES],
}

impl SortitionDraw {
    pub const LEN: usize = 8
        + 16
        + 32
        + 5
        + 32
        + 8 * 3
        + 8
        + 8
        + 32
        + 1
        + 32
        + 8 * 3
        + 32 * 3
        + 8
        + 8
        + 1
        + 1
        + 1 // fee_mode
        + 8 // entry_fee_lamports
        + 2 // close_skim_bps
        + SORTITION_RESERVED_BYTES;
}

#[account]
pub struct TicketCommit {
    pub draw_id: [u8; 16],
    pub ticket_id: [u8; 16],
    pub owner: Pubkey,
    pub commitment: [u8; 32],
    pub claimed: bool,
    pub bump: u8,
    pub reserved: [u8; TICKET_RESERVED_BYTES],
}

impl TicketCommit {
    pub const LEN: usize = 8 + 16 + 16 + 32 + 32 + 1 + 1 + TICKET_RESERVED_BYTES;
}
