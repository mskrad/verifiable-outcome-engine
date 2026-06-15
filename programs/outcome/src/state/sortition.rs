use anchor_lang::prelude::*;

pub const SORTITION_STATUS_REGISTERING: u8 = 1;
pub const SORTITION_STATUS_SEALED: u8 = 2;
pub const SORTITION_STATUS_CLOSED: u8 = 3;
pub const SORTITION_STANDARD_VERSION: [u8; 5] = *b"1.4.0";
pub const SORTITION_RESERVED_BYTES: usize = 31;
pub const TICKET_RESERVED_BYTES: usize = 30;

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
