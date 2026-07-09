//! SF1 — Slot Format v1 (`FORMAT_VERSION_SLOT = 10`).
//!
//! A committed slot game (reels / paylines / paytable / RTP-scale) as a `W3O1`
//! artifact, plus a deterministic spin-replay core. The replay reproduces the legacy
//! slot math bit-for-bit (`web3-slot-marketplace/.../math/compiled_v2.rs` +
//! Java `SlotMathEngineImpl.spinLamports`) so that on-chain outcomes agree with the
//! off-chain RTP balancer (the Java `slotsim`), which is the source of `paytable_scale`.
//!
//! Layout (little-endian, tightly packed, exact length asserted):
//!   magic b"W3O1"(4) ‖ format_version:u16(=10) ‖ min_input_lamports:u64 ‖
//!   max_input_lamports:u64 ‖ max_win_multiplier:u32(×10000) ‖ rows:u8 ‖ cols:u8 ‖
//!   symbol_count:u8 ‖ wild_idx:u8 ‖ scatter_idx:u8 ‖ paylines_count:u16 ‖
//!   paytable_scale_num:u32 ‖ paytable_scale_den:u32 ‖
//!   reels[cols]: (reel_len:u16 ‖ reel_len × symbol_idx:u8) ‖
//!   paylines[paylines_count × cols]: row_idx:u8 ‖
//!   paytable[symbol_count × (cols+1)]: scaled_multiplier:u64.
//!
//! This module is pure parsing + math; custody, RNG wiring, bet-range and max-win
//! enforcement live in the slot instructions (STUDIO-PROTOCOL-002).

use anchor_lang::prelude::*;

use crate::errors::OutcomeError;
use crate::math::compiled_outcome_v1::{MAGIC, MAX_COMPILED_ARTIFACT_BYTES};

/// On-chain artifact registry id for SF1 (distinct from protocol revision v1.2/v1.3.x).
pub const FORMAT_VERSION_SLOT: u16 = 10;
/// Fixed-point denominator that decodes a paytable multiplier (e.g. 20000 → 2.0x).
pub const SLOT_MULTIPLIER_SCALE: u64 = 10_000;
/// Upper bound on rows / cols (mirrors legacy `MAX_REELS_V2`).
pub const MAX_SLOT_DIM: usize = 16;
/// Slot-spin rng_v2 target offsets: last target matures ~2.0s after prepare
/// (~400ms/slot). Fixed window, no jitter — the reveal hides inside the reel
/// animation. Safety floor is offset >= 2 slots; security comes from
/// bet-before-seed, not from the offset size.
pub const SLOT_RNG_TARGET_OFFSETS: [u64; 3] = [3, 4, 5];
/// Bytes consumed by the fixed header up to (and including) the two scale fields.
const SLOT_HEADER_BYTES: usize = 41;

/// Parsed, validated view over an SF1 blob. Slices borrow from the blob.
#[derive(Clone, Copy)]
pub struct SlotSpec<'a> {
    pub min_input_lamports: u64,
    pub max_input_lamports: u64,
    pub max_win_multiplier: u32,
    pub rows: u8,
    pub cols: u8,
    pub symbol_count: u8,
    pub wild_idx: u8,
    pub scatter_idx: u8,
    pub paylines_count: u16,
    pub paytable_scale_num: u32,
    pub paytable_scale_den: u32,
    pub reels: [(&'a [u8], usize); MAX_SLOT_DIM], // (slice, len); only first `cols` used
    pub paylines_off: usize,
    pub paytable_off: usize,
}

/// Deterministic result of one spin replay.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlotSpinOutcome {
    pub total_win_lamports: u64,
    pub reel_count: u8,
    pub reel_stops: [u16; MAX_SLOT_DIM], // only first `reel_count` meaningful
}

impl Default for SlotSpinOutcome {
    fn default() -> Self {
        Self {
            total_win_lamports: 0,
            reel_count: 0,
            reel_stops: [0u16; MAX_SLOT_DIM],
        }
    }
}

fn read_u16_le(input: &[u8], off: &mut usize) -> Result<u16> {
    if *off + 2 > input.len() {
        return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
    let v = u16::from_le_bytes([input[*off], input[*off + 1]]);
    *off += 2;
    Ok(v)
}

fn read_u32_le(input: &[u8], off: &mut usize) -> Result<u32> {
    if *off + 4 > input.len() {
        return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
    let v = u32::from_le_bytes([
        input[*off],
        input[*off + 1],
        input[*off + 2],
        input[*off + 3],
    ]);
    *off += 4;
    Ok(v)
}

fn read_u64_le(input: &[u8], off: &mut usize) -> Result<u64> {
    if *off + 8 > input.len() {
        return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
    let v = u64::from_le_bytes([
        input[*off],
        input[*off + 1],
        input[*off + 2],
        input[*off + 3],
        input[*off + 4],
        input[*off + 5],
        input[*off + 6],
        input[*off + 7],
    ]);
    *off += 8;
    Ok(v)
}

/// Structurally validate and parse an SF1 blob. Returns `InvalidCompiledArtifactFormat`
/// on any malformed input; the exact-length assertion rejects trailing bytes.
pub fn parse(blob: &[u8]) -> Result<SlotSpec<'_>> {
    require!(
        !blob.is_empty() && blob.len() <= MAX_COMPILED_ARTIFACT_BYTES,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        blob.len() >= SLOT_HEADER_BYTES,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(&blob[0..4] == MAGIC, OutcomeError::InvalidCompiledArtifactFormat);

    let mut off = 4usize;
    let format_version = read_u16_le(blob, &mut off)?;
    require!(
        format_version == FORMAT_VERSION_SLOT,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let min_input_lamports = read_u64_le(blob, &mut off)?;
    let max_input_lamports = read_u64_le(blob, &mut off)?;
    require!(
        min_input_lamports <= max_input_lamports,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let max_win_multiplier = read_u32_le(blob, &mut off)?;
    require!(
        max_win_multiplier > 0,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    // Fixed 5-byte dims block at offset 26.
    let rows = blob[off];
    let cols = blob[off + 1];
    let symbol_count = blob[off + 2];
    let wild_idx = blob[off + 3];
    let scatter_idx = blob[off + 4];
    off += 5;

    require!(rows > 0 && cols > 0, OutcomeError::InvalidCompiledArtifactFormat);
    require!(
        rows as usize <= MAX_SLOT_DIM && cols as usize <= MAX_SLOT_DIM,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(symbol_count > 0, OutcomeError::InvalidCompiledArtifactFormat);
    require!(
        wild_idx < symbol_count && scatter_idx < symbol_count,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let paylines_count = read_u16_le(blob, &mut off)?;
    require!(paylines_count > 0, OutcomeError::InvalidCompiledArtifactFormat);

    let paytable_scale_num = read_u32_le(blob, &mut off)?;
    let paytable_scale_den = read_u32_le(blob, &mut off)?;
    require!(
        paytable_scale_num > 0 && paytable_scale_den > 0,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    debug_assert_eq!(off, SLOT_HEADER_BYTES);

    // Reels: one strip per column, each `u16 len` + `len` symbol bytes.
    let mut reels: [(&[u8], usize); MAX_SLOT_DIM] = [(&[][..], 0); MAX_SLOT_DIM];
    for col in 0..(cols as usize) {
        let len = read_u16_le(blob, &mut off)? as usize;
        require!(len > 0, OutcomeError::InvalidCompiledArtifactFormat);
        require!(off + len <= blob.len(), OutcomeError::InvalidCompiledArtifactFormat);
        let slice = &blob[off..off + len];
        for &sym in slice {
            require!(sym < symbol_count, OutcomeError::InvalidCompiledArtifactFormat);
        }
        reels[col] = (slice, len);
        off += len;
    }

    // Paylines: `paylines_count × cols` row indices, each `< rows`.
    let paylines_off = off;
    let paylines_bytes = (paylines_count as usize)
        .checked_mul(cols as usize)
        .ok_or(OutcomeError::MathOverflow)?;
    require!(
        off + paylines_bytes <= blob.len(),
        OutcomeError::InvalidCompiledArtifactFormat
    );
    for i in 0..paylines_bytes {
        require!(blob[off + i] < rows, OutcomeError::InvalidCompiledArtifactFormat);
    }
    off += paylines_bytes;

    // Paytable: `symbol_count × (cols+1)` u64 entries.
    let paytable_off = off;
    let counts_per_symbol = (cols as usize)
        .checked_add(1)
        .ok_or(OutcomeError::MathOverflow)?;
    let paytable_entries = (symbol_count as usize)
        .checked_mul(counts_per_symbol)
        .ok_or(OutcomeError::MathOverflow)?;
    let paytable_bytes = paytable_entries
        .checked_mul(8)
        .ok_or(OutcomeError::MathOverflow)?;
    require!(
        off + paytable_bytes <= blob.len(),
        OutcomeError::InvalidCompiledArtifactFormat
    );
    off += paytable_bytes;

    // No trailing bytes, no padding.
    require!(off == blob.len(), OutcomeError::InvalidCompiledArtifactFormat);

    Ok(SlotSpec {
        min_input_lamports,
        max_input_lamports,
        max_win_multiplier,
        rows,
        cols,
        symbol_count,
        wild_idx,
        scatter_idx,
        paylines_count,
        paytable_scale_num,
        paytable_scale_den,
        reels,
        paylines_off,
        paytable_off,
    })
}

/// Per-spin vault exposure cap: `round(bet × max_win_multiplier / 10000)`.
/// Checked against the vault balance at prepare and clamps the payout at settle.
pub fn max_win_cap(bet_lamports: u64, max_win_multiplier: u32) -> u64 {
    let scaled = (bet_lamports as u128).saturating_mul(max_win_multiplier as u128);
    let rounded = (scaled + (SLOT_MULTIPLIER_SCALE as u128 / 2)) / SLOT_MULTIPLIER_SCALE as u128;
    u64::try_from(rounded).unwrap_or(u64::MAX)
}

/// xorshift64* — state mutated before the multiply; unsigned modulo, no rejection
/// sampling. Byte-identical to legacy `compiled_v2::next_int` and Java `RngUtils.nextInt`.
fn next_int(state: &mut u64, bound: usize) -> usize {
    let mut x = *state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    *state = x;
    let result = x.wrapping_mul(0x2545F4914F6CDD1D);
    (result % bound as u64) as usize
}

/// Apply the RTP-balancing scale `num/den` with round-half-up. Matches legacy
/// `compiled_v2::scale_multiplier_round` and Java `scaleRound`.
fn scale_multiplier_round(base: u64, num: u32, den: u32) -> u64 {
    if den == 0 {
        return 0;
    }
    let scaled = (base as u128).saturating_mul(num as u128);
    let rounded = (scaled + (den as u128 / 2)) / den as u128;
    u64::try_from(rounded).unwrap_or(u64::MAX)
}

/// Deterministically replay one spin. `randomness` is the 32-byte rng_v2 output
/// (STUDIO-PROTOCOL-002 supplies it via `rng_v2::derive_randomness`); the RNG state is
/// seeded from its first 8 bytes little-endian. Returns the raw win (no max-win clamp;
/// that is applied by the settle instruction).
///
/// Payout parity (line + scatter) follows Java `spinLamports`: line wins scale
/// `line_bet = bet / paylines_count`, scatter wins scale the full `bet_lamports`; both
/// use two-stage rounding (`/MULTIPLIER_SCALE` truncates first, then `scale_*_round`).
pub fn replay_spin(
    blob: &[u8],
    randomness: &[u8; 32],
    bet_lamports: u64,
) -> Result<SlotSpinOutcome> {
    let spec = parse(blob)?;

    let cols = spec.cols as usize;
    let rows = spec.rows as usize;
    let wild_idx = spec.wild_idx;
    let scatter_idx = spec.scatter_idx;

    let mut outcome = SlotSpinOutcome {
        reel_count: spec.cols,
        ..Default::default()
    };

    let mut seed_bytes = [0u8; 8];
    seed_bytes.copy_from_slice(&randomness[..8]);
    let mut state = u64::from_le_bytes(seed_bytes);

    let mut grid = [[0u8; MAX_SLOT_DIM]; MAX_SLOT_DIM];
    for col in 0..cols {
        let (reel, reel_len) = spec.reels[col];
        let stop = next_int(&mut state, reel_len);
        outcome.reel_stops[col] = stop as u16;
        for row in 0..rows {
            grid[row][col] = reel[(stop + row) % reel_len];
        }
    }

    let paylines_count = spec.paylines_count as usize;
    let line_bet = bet_lamports / paylines_count as u64;
    let paytable_stride = (cols + 1) * 8;
    let mut total_win = 0u64;

    // Line wins: left-to-right, scatter breaks the run, wild counts and continues.
    for line in 0..paylines_count {
        let mut target: i16 = -1;
        let mut count: usize = 0;
        for col in 0..cols {
            let row = blob[spec.paylines_off + line * cols + col] as usize;
            let symbol = grid[row][col];
            if symbol == scatter_idx {
                break;
            }
            if symbol == wild_idx {
                count += 1;
                continue;
            }
            if target == -1 {
                target = symbol as i16;
                count += 1;
            } else if symbol as i16 == target {
                count += 1;
            } else {
                break;
            }
        }
        if count >= 3 {
            let idx: u8 = if target == -1 { wild_idx } else { target as u8 };
            let count_clamped = core::cmp::min(count, cols);
            let sym_off = spec.paytable_off + idx as usize * paytable_stride + count_clamped * 8;
            let mut tmp = sym_off;
            let mult_scaled = read_u64_le(blob, &mut tmp)?;
            if mult_scaled == 0 {
                continue;
            }
            let base = (line_bet as u128).saturating_mul(mult_scaled as u128)
                / (SLOT_MULTIPLIER_SCALE as u128);
            let base_u64 = u64::try_from(base).unwrap_or(u64::MAX);
            let win = scale_multiplier_round(base_u64, spec.paytable_scale_num, spec.paytable_scale_den);
            total_win = total_win.saturating_add(win);
        }
    }

    // Scatter wins: counted anywhere on the grid, scaling the full bet. Present in the
    // Java engine / legacy `math.rs` (absent from legacy on-chain `compiled_v2.rs`);
    // included here so on-chain RTP matches the balancer.
    let mut scatter_count = 0usize;
    for row in 0..rows {
        for col in 0..cols {
            if grid[row][col] == scatter_idx {
                scatter_count += 1;
            }
        }
    }
    if scatter_count >= 3 {
        let count_clamped = core::cmp::min(scatter_count, cols);
        let sym_off = spec.paytable_off + scatter_idx as usize * paytable_stride + count_clamped * 8;
        let mut tmp = sym_off;
        let mult_scaled = read_u64_le(blob, &mut tmp)?;
        if mult_scaled > 0 {
            let base = (bet_lamports as u128).saturating_mul(mult_scaled as u128)
                / (SLOT_MULTIPLIER_SCALE as u128);
            let base_u64 = u64::try_from(base).unwrap_or(u64::MAX);
            let win = scale_multiplier_round(base_u64, spec.paytable_scale_num, spec.paytable_scale_den);
            total_win = total_win.saturating_add(win);
        }
    }

    outcome.total_win_lamports = total_win;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    // demo_5x3_v1: 3 rows × 5 cols, 5 symbols (wild=3, scatter=4), 3 paylines.
    const DEMO_REELS: [&[u8]; 5] = [
        &[0, 1, 2, 3],
        &[1, 0, 2, 3],
        &[0, 0, 1, 2],
        &[2, 1, 0, 3],
        &[1, 2, 0, 3],
    ];
    const DEMO_PAYLINES: [[u8; 5]; 3] = [
        [0, 0, 0, 0, 0],
        [1, 1, 1, 1, 1],
        [2, 2, 2, 2, 2],
    ];
    // paytable[symbol][matched] scaled by MULTIPLIER_SCALE (indices 0..=cols).
    const DEMO_PAYTABLE: [[u64; 6]; 5] = [
        [0, 0, 0, 20_000, 50_000, 100_000],
        [0, 0, 0, 15_000, 30_000, 60_000],
        [0, 0, 0, 10_000, 20_000, 40_000],
        [0, 0, 0, 30_000, 70_000, 120_000],
        [0, 0, 0, 20_000, 50_000, 80_000],
    ];

    fn push_u16(out: &mut Vec<u8>, v: u16) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    fn push_u32(out: &mut Vec<u8>, v: u32) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    fn push_u64(out: &mut Vec<u8>, v: u64) {
        out.extend_from_slice(&v.to_le_bytes());
    }

    fn build_demo_blob(
        min_input: u64,
        max_input: u64,
        max_win_multiplier: u32,
        scale_num: u32,
        scale_den: u32,
    ) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(MAGIC);
        push_u16(&mut b, FORMAT_VERSION_SLOT);
        push_u64(&mut b, min_input);
        push_u64(&mut b, max_input);
        push_u32(&mut b, max_win_multiplier);
        b.push(3); // rows
        b.push(5); // cols
        b.push(5); // symbol_count
        b.push(3); // wild_idx
        b.push(4); // scatter_idx
        push_u16(&mut b, 3); // paylines_count
        push_u32(&mut b, scale_num);
        push_u32(&mut b, scale_den);
        for reel in DEMO_REELS.iter() {
            push_u16(&mut b, reel.len() as u16);
            b.extend_from_slice(reel);
        }
        for line in DEMO_PAYLINES.iter() {
            b.extend_from_slice(line);
        }
        for sym in DEMO_PAYTABLE.iter() {
            for &v in sym.iter() {
                push_u64(&mut b, v);
            }
        }
        b
    }

    fn demo_blob() -> Vec<u8> {
        build_demo_blob(1_000, 1_000_000_000, 1_000_000, 2_048, 2_048)
    }

    #[test]
    fn parses_demo_and_binds_fields() {
        let blob = demo_blob();
        // Header pins.
        assert_eq!(&blob[0..4], MAGIC);
        assert_eq!(u16::from_le_bytes([blob[4], blob[5]]), FORMAT_VERSION_SLOT);

        let spec = parse(&blob).unwrap();
        assert_eq!(spec.rows, 3);
        assert_eq!(spec.cols, 5);
        assert_eq!(spec.symbol_count, 5);
        assert_eq!(spec.wild_idx, 3);
        assert_eq!(spec.scatter_idx, 4);
        assert_eq!(spec.paylines_count, 3);
        assert_eq!(spec.min_input_lamports, 1_000);
        assert_eq!(spec.max_input_lamports, 1_000_000_000);
        assert_eq!(spec.max_win_multiplier, 1_000_000);
        assert_eq!(spec.paytable_scale_num, 2_048);
        assert_eq!(spec.paytable_scale_den, 2_048);
        for col in 0..5 {
            assert_eq!(spec.reels[col].1, 4);
        }
    }

    #[test]
    fn demo_blob_matches_cross_language_golden() {
        // Same demo artifact is built independently by sdk/slot.ts (encodeSlotArtifact)
        // and scripts/slot_ts_parity.ts; all three must agree byte-for-byte.
        let blob = demo_blob();
        assert_eq!(blob.len(), 326);
        let expected: [u8; 32] = [
            0xd4, 0x55, 0x9e, 0xf2, 0xd4, 0x08, 0x8d, 0xd4, 0x3c, 0x94, 0x80, 0x2f, 0x51, 0xb2,
            0x72, 0x5b, 0x08, 0x69, 0xc9, 0x2e, 0x3e, 0xaf, 0x33, 0x33, 0x0d, 0x47, 0x51, 0x75,
            0x40, 0xfb, 0xfe, 0x39,
        ];
        assert_eq!(crate::math::sha::sha256(&blob), expected);
    }

    #[test]
    fn replay_is_deterministic() {
        let blob = demo_blob();
        let randomness = [7u8; 32];
        let a = replay_spin(&blob, &randomness, 100_000).unwrap();
        let b = replay_spin(&blob, &randomness, 100_000).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.reel_count, 5);
    }

    // Golden vectors — independently computed by an external oracle (Python mirror of
    // the xorshift64* + line/scatter algorithm). See STUDIO-PROTOCOL-001 notes.
    // PLACEHOLDER values filled after the oracle run.
    #[test]
    fn replay_golden_vectors() {
        let blob = demo_blob();
        let bet = 100_000u64;

        // Vector A: seed bytes chosen to hit a paying line.
        let mut rnd_a = [0u8; 32];
        rnd_a[..8].copy_from_slice(&ORACLE_A_SEED.to_le_bytes());
        let a = replay_spin(&blob, &rnd_a, bet).unwrap();
        assert_eq!(a.reel_stops[..5], ORACLE_A_STOPS);
        assert_eq!(a.total_win_lamports, ORACLE_A_WIN);

        // Vector B: different seed.
        let mut rnd_b = [0u8; 32];
        rnd_b[..8].copy_from_slice(&ORACLE_B_SEED.to_le_bytes());
        let b = replay_spin(&blob, &rnd_b, bet).unwrap();
        assert_eq!(b.reel_stops[..5], ORACLE_B_STOPS);
        assert_eq!(b.total_win_lamports, ORACLE_B_WIN);
    }

    // Vector A (seed=1): payline 2 = wild, wild, 0, wild, 0 → 5-of-symbol-0,
    // paytable[0][5]=100000, line_bet=33333 → 333330. No scatter.
    const ORACLE_A_SEED: u64 = 1;
    const ORACLE_A_STOPS: [u16; 5] = [1, 1, 3, 1, 0];
    const ORACLE_A_WIN: u64 = 333_330;
    // Vector B (seed=0): no line reaches 3 matches, no scatter → zero win.
    const ORACLE_B_SEED: u64 = 0;
    const ORACLE_B_STOPS: [u16; 5] = [0, 0, 0, 0, 0];
    const ORACLE_B_WIN: u64 = 0;

    #[test]
    fn max_win_cap_rounds_half_up() {
        // 1000 lamports × 2.5x (25000/10000) = 2500
        assert_eq!(max_win_cap(1_000, 25_000), 2_500);
        // rounding: 3 × 1.6667x (16667/10000) = 5.0001 → floor((3*16667+5000)/10000) = 5
        assert_eq!(max_win_cap(3, 16_667), 5);
        // 5000x cap on 100k bet
        assert_eq!(max_win_cap(100_000, 50_000_000), 500_000_000);
        // saturation, no overflow
        assert_eq!(max_win_cap(u64::MAX, u32::MAX), u64::MAX);
    }

    #[test]
    fn slot_offsets_are_short_and_ordered() {
        assert_eq!(SLOT_RNG_TARGET_OFFSETS, [3, 4, 5]);
        assert!(SLOT_RNG_TARGET_OFFSETS[0] >= 2);
        assert!(SLOT_RNG_TARGET_OFFSETS.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn rejects_bad_magic() {
        let mut blob = demo_blob();
        blob[0] = b'X';
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_wrong_version() {
        let mut blob = demo_blob();
        blob[4] = 9; // format_version low byte → 9
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_symbol_out_of_range() {
        // First reel byte sits right after the 41-byte header + first reel len (u16).
        let mut blob = demo_blob();
        let first_reel_symbol = SLOT_HEADER_BYTES + 2;
        blob[first_reel_symbol] = 99; // >= symbol_count
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_payline_row_out_of_range() {
        let blob = demo_blob();
        let spec = parse(&blob).unwrap();
        let mut bad = blob.clone();
        bad[spec.paylines_off] = 3; // rows == 3, so row index 3 is invalid
        assert!(parse(&bad).is_err());
    }

    #[test]
    fn rejects_zero_scale_den() {
        // scale_den is the last u32 of the fixed header (offset 37..41).
        let mut blob = demo_blob();
        for i in 37..41 {
            blob[i] = 0;
        }
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut blob = demo_blob();
        blob.push(0);
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_truncated_blob() {
        let blob = demo_blob();
        assert!(parse(&blob[..blob.len() - 1]).is_err());
    }

    #[test]
    fn rejects_min_greater_than_max() {
        let blob = build_demo_blob(2_000, 1_000, 1_000_000, 2_048, 2_048);
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_zero_max_win_multiplier() {
        let blob = build_demo_blob(1_000, 1_000_000_000, 0, 2_048, 2_048);
        assert!(parse(&blob).is_err());
    }
}
