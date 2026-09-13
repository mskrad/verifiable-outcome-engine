use anchor_lang::prelude::*;
use crate::math::sha::Sha256;

use crate::errors::OutcomeError;

pub const RNG_V2_VERSION: u8 = 2;
pub const RNG_V2_DOMAIN: &[u8] = b"VRE_RNG_V2";
pub const RNG_V2_TARGET_OFFSETS: [u64; 3] = [75, 90, 105];
pub const RNG_V2_EXPIRY_AFTER_LAST_TARGET: u64 = 480;
/// v1.3.2: grace window (slots) after expiry during which a SEALED draw waits for
/// attest_winners before any party may expire_sealed it.
pub const RNG_V2_ATTEST_DEADLINE_AFTER_EXPIRY: u64 = 480;
pub const SLOT_HASHES_ENTRY_BYTES: usize = 40;

/// Target offsets for `prepare_rng_v2` draws (INFRA-021, 2026-09-13).
///
/// A Solana leader produces `NUM_CONSECUTIVE_LEADER_SLOTS` (4) slots in a row. The prepare
/// transaction lands in slot N inside some group `[4k, 4k+3]`; `N + 8 >= 4k + 8`, so the first
/// target is always at least two groups later and the leader that included prepare never
/// produces a target slot. A step of 8 puts the three targets in three different groups.
/// The last target matures ~10 s after prepare instead of ~42 s. Sortition keeps
/// `RNG_V2_TARGET_OFFSETS`: its registration window must stay shorter than the first offset.
pub const RNG_V2_DRAW_TARGET_OFFSETS: [u64; 3] = [8, 16, 24];

fn target_slots_from(current_slot: u64, offsets: [u64; 3]) -> Result<([u64; 3], u64)> {
    let target_slots = [
        current_slot
            .checked_add(offsets[0])
            .ok_or(OutcomeError::MathOverflow)?,
        current_slot
            .checked_add(offsets[1])
            .ok_or(OutcomeError::MathOverflow)?,
        current_slot
            .checked_add(offsets[2])
            .ok_or(OutcomeError::MathOverflow)?,
    ];
    let expiry_slot = target_slots[2]
        .checked_add(RNG_V2_EXPIRY_AFTER_LAST_TARGET)
        .ok_or(OutcomeError::MathOverflow)?;
    Ok((target_slots, expiry_slot))
}

/// Sortition and Unicorn-G targets: `RNG_V2_TARGET_OFFSETS`.
pub fn derive_target_slots(current_slot: u64) -> Result<([u64; 3], u64)> {
    target_slots_from(current_slot, RNG_V2_TARGET_OFFSETS)
}

/// `prepare_rng_v2` draw targets: `RNG_V2_DRAW_TARGET_OFFSETS`.
pub fn derive_draw_target_slots(current_slot: u64) -> Result<([u64; 3], u64)> {
    target_slots_from(current_slot, RNG_V2_DRAW_TARGET_OFFSETS)
}

pub fn hash_operator_reveal(reveal: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(reveal);
    hasher.finalize().into()
}

pub fn derive_seed(
    runtime_id: &[u8; 16],
    resolve_id: u64,
    compiled_artifact_hash: &[u8; 32],
    snapshot_hash: &[u8; 32],
    resolved_slots: &[u64; 3],
    slot_hashes: &[[u8; 32]; 3],
    operator_commit_present: bool,
    operator_commit_hash: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(RNG_V2_DOMAIN);
    hasher.update(runtime_id);
    hasher.update(resolve_id.to_le_bytes());
    hasher.update(compiled_artifact_hash);
    hasher.update(snapshot_hash);
    for index in 0..3 {
        hasher.update(resolved_slots[index].to_le_bytes());
        hasher.update(slot_hashes[index]);
    }
    if operator_commit_present {
        hasher.update(operator_commit_hash);
    }
    hasher.finalize().into()
}

pub fn derive_randomness(
    seed: &[u8; 32],
    runtime_id: &[u8; 16],
    resolve_id: u64,
    actor: &Pubkey,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(seed);
    hasher.update(runtime_id);
    hasher.update(resolve_id.to_le_bytes());
    hasher.update(actor.as_ref());
    hasher.finalize().into()
}

pub fn read_slot_hashes_len(data: &[u8]) -> Result<usize> {
    require!(data.len() >= 8, OutcomeError::InvalidSlotHashesSysvar);
    let mut len_bytes = [0u8; 8];
    len_bytes.copy_from_slice(&data[..8]);
    let len = u64::from_le_bytes(len_bytes);
    usize::try_from(len).map_err(|_| error!(OutcomeError::InvalidSlotHashesSysvar))
}

fn read_slot_hash_entry(data: &[u8], index: usize) -> Result<(u64, [u8; 32])> {
    let start = 8usize
        .checked_add(
            index
                .checked_mul(SLOT_HASHES_ENTRY_BYTES)
                .ok_or(OutcomeError::MathOverflow)?,
        )
        .ok_or(OutcomeError::MathOverflow)?;
    let end = start
        .checked_add(SLOT_HASHES_ENTRY_BYTES)
        .ok_or(OutcomeError::MathOverflow)?;
    require!(end <= data.len(), OutcomeError::InvalidSlotHashesSysvar);
    let mut slot_bytes = [0u8; 8];
    slot_bytes.copy_from_slice(&data[start..start + 8]);
    let slot = u64::from_le_bytes(slot_bytes);
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&data[start + 8..end]);
    Ok((slot, hash))
}

pub fn resolve_slot_hashes(
    data: &[u8],
    target_slots: &[u64; 3],
) -> Result<([u64; 3], [[u8; 32]; 3])> {
    let len = read_slot_hashes_len(data)?;
    let mut resolved_slots = [0u64; 3];
    let mut slot_hashes = [[0u8; 32]; 3];
    let mut previous_resolved_slot = 0u64;

    for target_index in 0..3 {
        let target_slot = target_slots[target_index];
        let mut selected_slot = u64::MAX;
        let mut selected_hash = [0u8; 32];

        for entry_index in 0..len {
            let (slot, hash) = read_slot_hash_entry(data, entry_index)?;
            if slot <= previous_resolved_slot {
                continue;
            }
            if slot == target_slot {
                selected_slot = slot;
                selected_hash = hash;
                break;
            }
            if slot > target_slot && slot < selected_slot {
                selected_slot = slot;
                selected_hash = hash;
            }
        }

        require!(
            selected_slot != u64::MAX,
            OutcomeError::RngV2SlotHashNotFound
        );
        resolved_slots[target_index] = selected_slot;
        slot_hashes[target_index] = selected_hash;
        previous_resolved_slot = selected_slot;
    }

    Ok((resolved_slots, slot_hashes))
}


/// Domain separator for the on-chain digest of a compact draw's winner list.
pub const RNG_V2_WINNERS_DOMAIN: &[u8] = b"VRE_RNG_V2_WINNERS";

/// `winner_claim_hash` for compact draws (INFRA-021 decision D-B): the program selects
/// the winners and binds the full list into `OutcomeResolutionV4.winner_claim_hash`.
/// Encoding: SHA256(domain ‖ count:u16le ‖ Σ(len:u8 ‖ id[..len])).
pub fn winner_claim_digest(outcome_id_lens: &[u8], outcome_ids: &[[u8; 64]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(RNG_V2_WINNERS_DOMAIN);
    hasher.update((outcome_id_lens.len() as u16).to_le_bytes());
    for (len, id) in outcome_id_lens.iter().zip(outcome_ids.iter()) {
        hasher.update([*len]);
        hasher.update(&id[..*len as usize]);
    }
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot_hashes_data(entries: &[(u64, [u8; 32])]) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&(entries.len() as u64).to_le_bytes());
        for (slot, hash) in entries {
            data.extend_from_slice(&slot.to_le_bytes());
            data.extend_from_slice(hash);
        }
        data
    }

    #[test]
    fn resolves_exact_targets() {
        let data = slot_hashes_data(&[(120, [3u8; 32]), (110, [2u8; 32]), (100, [1u8; 32])]);
        let (slots, hashes) = resolve_slot_hashes(&data, &[100, 110, 120]).unwrap();
        assert_eq!(slots, [100, 110, 120]);
        assert_eq!(hashes, [[1u8; 32], [2u8; 32], [3u8; 32]]);
    }

    #[test]
    fn resolves_skipped_target_to_next_distinct_present_slot() {
        let data = slot_hashes_data(&[
            (123, [4u8; 32]),
            (120, [3u8; 32]),
            (112, [2u8; 32]),
            (100, [1u8; 32]),
        ]);
        let (slots, hashes) = resolve_slot_hashes(&data, &[101, 112, 120]).unwrap();
        assert_eq!(slots, [112, 120, 123]);
        assert_eq!(hashes, [[2u8; 32], [3u8; 32], [4u8; 32]]);
    }

    #[test]
    fn derives_stable_seed_and_randomness() {
        let runtime_id = [3u8; 16];
        let artifact_hash = [4u8; 32];
        let snapshot_hash = [5u8; 32];
        let slots = [100, 115, 130];
        let hashes = [[6u8; 32], [7u8; 32], [8u8; 32]];
        let commit_hash = [9u8; 32];
        let actor = Pubkey::new_from_array([10u8; 32]);
        let seed = derive_seed(
            &runtime_id,
            42,
            &artifact_hash,
            &snapshot_hash,
            &slots,
            &hashes,
            true,
            &commit_hash,
        );
        let randomness = derive_randomness(&seed, &runtime_id, 42, &actor);
        assert_eq!(
            seed,
            [
                198, 169, 58, 29, 150, 4, 156, 59, 243, 152, 150, 207, 14, 126, 115, 8, 26,
                225, 251, 230, 131, 175, 12, 230, 169, 146, 146, 101, 248, 166, 195, 217
            ]
        );
        assert_eq!(
            randomness,
            [
                12, 255, 242, 121, 68, 204, 238, 124, 73, 130, 53, 72, 140, 174, 75, 80, 55,
                62, 141, 32, 225, 158, 16, 89, 118, 54, 16, 254, 178, 138, 237, 80
            ]
        );
    }

    #[test]
    fn winner_claim_digest_matches_reference_vector() {
        let mut alice = [0u8; 64];
        alice[..5].copy_from_slice(b"alice");
        let mut bob = [0u8; 64];
        bob[..3].copy_from_slice(b"bob");
        assert_eq!(
            winner_claim_digest(&[5, 3], &[alice, bob]),
            [
                156, 89, 97, 221, 182, 200, 69, 233, 72, 56, 105, 119, 220, 131, 213, 160, 181,
                38, 66, 129, 154, 12, 85, 224, 183, 121, 158, 68, 254, 69, 227, 60
            ]
        );
        assert_eq!(
            winner_claim_digest(&[], &[]),
            [
                223, 127, 59, 242, 0, 25, 160, 78, 232, 237, 34, 55, 73, 48, 109, 166, 0, 210,
                24, 232, 157, 210, 13, 45, 68, 251, 135, 143, 17, 100, 42, 30
            ]
        );
    }

    #[test]
    fn draw_offsets_avoid_the_including_leader_and_spread_across_groups() {
        use anchor_lang::solana_program::clock::NUM_CONSECUTIVE_LEADER_SLOTS as LEADER_SLOTS;
        // solana-slot-hashes 2.2.1: `pub const MAX_ENTRIES: usize = 512`; not re-exported by anchor_lang.
        const MAX_ENTRIES: usize = 512;
        for offsets in [RNG_V2_DRAW_TARGET_OFFSETS, RNG_V2_TARGET_OFFSETS] {
            // First target at least two leader groups after the prepare slot.
            assert!(offsets[0] >= 2 * LEADER_SLOTS, "{offsets:?}");
            // Each target in a different leader group from the previous one.
            assert!(offsets.windows(2).all(|w| w[1] - w[0] >= LEADER_SLOTS), "{offsets:?}");
            // The first target's hash is still in the SlotHashes sysvar at expiry.
            assert!(
                RNG_V2_EXPIRY_AFTER_LAST_TARGET + (offsets[2] - offsets[0]) < MAX_ENTRIES as u64,
                "{offsets:?}"
            );
        }
        // Worst and best landing positions inside a leader group.
        for prepare_slot in [4_000u64, 4_003] {
            let (targets, expiry) = derive_draw_target_slots(prepare_slot).unwrap();
            let groups: Vec<u64> = targets.iter().map(|slot| slot / LEADER_SLOTS).collect();
            assert!(groups[0] >= prepare_slot / LEADER_SLOTS + 2);
            assert!(groups[0] < groups[1] && groups[1] < groups[2]);
            assert_eq!(expiry, targets[2] + RNG_V2_EXPIRY_AFTER_LAST_TARGET);
        }
    }
}
