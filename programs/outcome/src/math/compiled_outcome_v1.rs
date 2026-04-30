use std::cmp::Ordering;

use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::errors::OutcomeError;

pub const MAGIC: &[u8; 4] = b"W3O1";
pub const FORMAT_VERSION_V1: u16 = 1;
pub const FORMAT_VERSION_V2: u16 = 2;
pub const FORMAT_VERSION_V3: u16 = 3;
pub const MAX_COMPILED_ARTIFACT_BYTES: usize = 8192;
pub const MAX_OUTCOME_ID_BYTES: usize = 64;
pub const MAX_WINNERS: usize = 32;
pub const EFFECT_ENTRY_BYTES: usize = 16;
pub const EFFECT_TYPE_TRANSFER_SOL: u8 = 1;
pub const FORMULA_WEIGHTED_RANDOM: u8 = 1;
pub const FORMULA_RANK_DESC: u8 = 2;
pub const FORMULA_RANK_ASC: u8 = 3;
pub const FORMULA_FIRST_N: u8 = 4;
pub const FORMULA_CLOSEST_TO: u8 = 5;
const MULTI_WINNER_DOMAIN: &[u8] = b"VRE_MULTI_WINNER_V1";
const HEADER_BYTES_V1_V2: usize = 34;
const HEADER_BYTES_V3: usize = 42;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParsedHeader {
    pub format_version: u16,
    pub min_input_lamports: u64,
    pub max_input_lamports: u64,
    pub outcome_count: u16,
    pub total_effect_count: u16,
    pub winners_count: u16,
    pub formula_code: u8,
    pub target_score: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParsedOutcome {
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub weight: u32,
    pub score: i64,
    pub order: u16,
    pub first_effect_index: u16,
    pub effect_count: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParsedEffect {
    pub effect_type: u8,
    pub amount_lamports: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedArtifact {
    pub header: ParsedHeader,
    pub outcomes: Vec<ParsedOutcome>,
    pub effects: Vec<ParsedEffect>,
    pub effects_offset: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SelectedOutcome {
    pub total_output_lamports: u64,
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelectedOutcomes {
    pub total_output_lamports: u64,
    pub outcome_id_lens: Vec<u8>,
    pub outcome_ids: Vec<[u8; MAX_OUTCOME_ID_BYTES]>,
    pub effect_count: u16,
    pub effects_digest: [u8; 32],
}

fn read_u8(input: &[u8], off: &mut usize) -> Result<u8> {
    if *off + 1 > input.len() {
        return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
    let value = input[*off];
    *off += 1;
    Ok(value)
}

fn read_u16_le(input: &[u8], off: &mut usize) -> Result<u16> {
    if *off + 2 > input.len() {
        return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
    let value = u16::from_le_bytes([input[*off], input[*off + 1]]);
    *off += 2;
    Ok(value)
}

fn read_u32_le(input: &[u8], off: &mut usize) -> Result<u32> {
    if *off + 4 > input.len() {
        return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
    let value = u32::from_le_bytes([
        input[*off],
        input[*off + 1],
        input[*off + 2],
        input[*off + 3],
    ]);
    *off += 4;
    Ok(value)
}

fn read_u64_le(input: &[u8], off: &mut usize) -> Result<u64> {
    if *off + 8 > input.len() {
        return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
    let value = u64::from_le_bytes([
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
    Ok(value)
}

fn read_i64_le(input: &[u8], off: &mut usize) -> Result<i64> {
    if *off + 8 > input.len() {
        return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
    let value = i64::from_le_bytes([
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
    Ok(value)
}

fn ensure_zero(bytes: &[u8]) -> Result<()> {
    require!(
        bytes.iter().all(|byte| *byte == 0),
        OutcomeError::InvalidReservedBytes
    );
    Ok(())
}

fn outcome_id_bytes(id: &[u8; MAX_OUTCOME_ID_BYTES], len: u8) -> &[u8] {
    &id[..len as usize]
}

fn ensure_ascii(bytes: &[u8]) -> Result<()> {
    require!(
        bytes.iter().all(|byte| byte.is_ascii()),
        OutcomeError::InvalidOutcomeId
    );
    Ok(())
}

fn ensure_valid_formula_code(value: u8) -> Result<()> {
    require!(
        matches!(
            value,
            FORMULA_WEIGHTED_RANDOM
                | FORMULA_RANK_DESC
                | FORMULA_RANK_ASC
                | FORMULA_FIRST_N
                | FORMULA_CLOSEST_TO
        ),
        OutcomeError::InvalidCompiledArtifactFormat
    );
    Ok(())
}

pub fn choose_weighted_index(weights: &[u32], random_u64: u64) -> Result<usize> {
    require!(
        !weights.is_empty(),
        OutcomeError::InvalidCompiledArtifactFormat
    );
    let mut total: u64 = 0;
    for weight in weights {
        require!(*weight > 0, OutcomeError::InvalidCompiledArtifactFormat);
        total = total
            .checked_add(*weight as u64)
            .ok_or(OutcomeError::MathOverflow)?;
    }
    let rolled = random_u64 % total;
    let mut cursor = 0u64;
    for (index, weight) in weights.iter().enumerate() {
        cursor = cursor
            .checked_add(*weight as u64)
            .ok_or(OutcomeError::MathOverflow)?;
        if rolled < cursor {
            return Ok(index);
        }
    }
    Err(error!(OutcomeError::MathOverflow))
}

fn roll_for_round(randomness: &[u8; 32], round: u16) -> u64 {
    if round == 0 {
        return u64::from_le_bytes(randomness[..8].try_into().unwrap());
    }

    let mut hasher = Sha256::new();
    hasher.update(MULTI_WINNER_DOMAIN);
    hasher.update(randomness);
    hasher.update(round.to_le_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    u64::from_le_bytes(digest[..8].try_into().unwrap())
}

fn compare_formula_outcomes(
    left: &ParsedOutcome,
    right: &ParsedOutcome,
    header: &ParsedHeader,
) -> Ordering {
    match header.formula_code {
        FORMULA_RANK_DESC => right
            .score
            .cmp(&left.score)
            .then(left.order.cmp(&right.order)),
        FORMULA_RANK_ASC => left
            .score
            .cmp(&right.score)
            .then(left.order.cmp(&right.order)),
        FORMULA_FIRST_N => left.order.cmp(&right.order),
        FORMULA_CLOSEST_TO => {
            let left_distance = ((left.score as i128) - (header.target_score as i128)).abs();
            let right_distance = ((right.score as i128) - (header.target_score as i128)).abs();
            left_distance
                .cmp(&right_distance)
                .then(left.order.cmp(&right.order))
        }
        _ => Ordering::Equal,
    }
}

fn select_outcome_indices(parsed: &ParsedArtifact, randomness: &[u8; 32]) -> Result<Vec<usize>> {
    if parsed.header.formula_code == FORMULA_WEIGHTED_RANDOM {
        let mut remaining: Vec<usize> = (0..parsed.outcomes.len()).collect();
        let mut selected = Vec::with_capacity(parsed.header.winners_count as usize);
        for round in 0..parsed.header.winners_count {
            let weights: Vec<u32> = remaining
                .iter()
                .map(|index| parsed.outcomes[*index].weight)
                .collect();
            let selected_remaining_index =
                choose_weighted_index(&weights, roll_for_round(randomness, round))?;
            selected.push(remaining.remove(selected_remaining_index));
        }
        return Ok(selected);
    }

    let mut ordered: Vec<usize> = (0..parsed.outcomes.len()).collect();
    ordered.sort_by(|left, right| {
        compare_formula_outcomes(
            &parsed.outcomes[*left],
            &parsed.outcomes[*right],
            &parsed.header,
        )
    });
    ordered.truncate(parsed.header.winners_count as usize);
    Ok(ordered)
}

pub fn parse(blob: &[u8]) -> Result<ParsedArtifact> {
    require!(
        !blob.is_empty() && blob.len() <= MAX_COMPILED_ARTIFACT_BYTES,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        blob.len() >= HEADER_BYTES_V1_V2,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        &blob[..4] == MAGIC,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let mut off = 4usize;
    let format_version = read_u16_le(blob, &mut off)?;
    require!(
        format_version == FORMAT_VERSION_V1
            || format_version == FORMAT_VERSION_V2
            || format_version == FORMAT_VERSION_V3,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    let min_input_lamports = read_u64_le(blob, &mut off)?;
    let max_input_lamports = read_u64_le(blob, &mut off)?;
    require!(
        min_input_lamports <= max_input_lamports,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    let outcome_count = read_u16_le(blob, &mut off)?;
    let total_effect_count = read_u16_le(blob, &mut off)?;
    let (winners_count, formula_code, target_score) = if format_version == FORMAT_VERSION_V1 {
        let reserved = &blob[off..off + 8];
        ensure_zero(reserved)?;
        off += 8;
        (1, FORMULA_WEIGHTED_RANDOM, 0)
    } else if format_version == FORMAT_VERSION_V2 {
        let winners_count = read_u16_le(blob, &mut off)?;
        ensure_zero(&blob[off..off + 6])?;
        off += 6;
        (winners_count, FORMULA_WEIGHTED_RANDOM, 0)
    } else {
        require!(
            blob.len() >= HEADER_BYTES_V3,
            OutcomeError::InvalidCompiledArtifactFormat
        );
        let winners_count = read_u16_le(blob, &mut off)?;
        let formula_code = read_u8(blob, &mut off)?;
        ensure_valid_formula_code(formula_code)?;
        ensure_zero(&blob[off..off + 5])?;
        off += 5;
        let target_score = read_i64_le(blob, &mut off)?;
        (winners_count, formula_code, target_score)
    };

    require!(
        outcome_count > 0,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        winners_count > 0
            && winners_count <= outcome_count
            && winners_count as usize <= MAX_WINNERS,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let mut outcomes = Vec::with_capacity(outcome_count as usize);
    let mut referenced_effects = vec![false; total_effect_count as usize];
    let mut previous_id: Option<Vec<u8>> = None;
    let mut weight_sum = 0u64;
    let mut seen_orders = vec![false; outcome_count as usize];

    for index in 0..outcome_count {
        let outcome_id_len = read_u8(blob, &mut off)?;
        require!(
            (1..=MAX_OUTCOME_ID_BYTES as u8).contains(&outcome_id_len),
            OutcomeError::InvalidOutcomeId
        );

        if off + MAX_OUTCOME_ID_BYTES > blob.len() {
            return Err(error!(OutcomeError::InvalidCompiledArtifactFormat));
        }

        let mut outcome_id = [0u8; MAX_OUTCOME_ID_BYTES];
        outcome_id.copy_from_slice(&blob[off..off + MAX_OUTCOME_ID_BYTES]);
        ensure_ascii(outcome_id_bytes(&outcome_id, outcome_id_len))?;
        ensure_zero(&outcome_id[outcome_id_len as usize..])?;
        let current_id = outcome_id_bytes(&outcome_id, outcome_id_len).to_vec();
        if let Some(previous) = &previous_id {
            require!(previous < &current_id, OutcomeError::InvalidOutcomeId);
        }
        previous_id = Some(current_id);
        off += MAX_OUTCOME_ID_BYTES;

        let weight = read_u32_le(blob, &mut off)?;
        require!(weight > 0, OutcomeError::InvalidCompiledArtifactFormat);
        weight_sum = weight_sum
            .checked_add(weight as u64)
            .ok_or(OutcomeError::MathOverflow)?;

        let (score, order) = if format_version == FORMAT_VERSION_V3 {
            let score = read_i64_le(blob, &mut off)?;
            let order = read_u16_le(blob, &mut off)?;
            require!(
                order < outcome_count,
                OutcomeError::InvalidCompiledArtifactFormat
            );
            require!(
                !seen_orders[order as usize],
                OutcomeError::InvalidCompiledArtifactFormat
            );
            seen_orders[order as usize] = true;
            (score, order)
        } else {
            (0, index)
        };

        let first_effect_index = read_u16_le(blob, &mut off)?;
        let effect_count = read_u16_le(blob, &mut off)?;
        let end_effect_index = first_effect_index
            .checked_add(effect_count)
            .ok_or(OutcomeError::MathOverflow)?;
        require!(
            end_effect_index <= total_effect_count,
            OutcomeError::InvalidCompiledArtifactFormat
        );
        for effect_index in first_effect_index as usize..end_effect_index as usize {
            if format_version != FORMAT_VERSION_V1 {
                require!(
                    !referenced_effects[effect_index],
                    OutcomeError::InvalidCompiledArtifactFormat
                );
            }
            referenced_effects[effect_index] = true;
        }

        outcomes.push(ParsedOutcome {
            outcome_id_len,
            outcome_id,
            weight,
            score,
            order,
            first_effect_index,
            effect_count,
        });
    }

    require!(weight_sum > 0, OutcomeError::InvalidCompiledArtifactFormat);
    if format_version == FORMAT_VERSION_V3 {
        require!(
            seen_orders.iter().all(|seen| *seen),
            OutcomeError::InvalidCompiledArtifactFormat
        );
    }

    let effects_offset = off;
    let mut effects = Vec::with_capacity(total_effect_count as usize);
    for _ in 0..total_effect_count {
        let effect_type = read_u8(blob, &mut off)?;
        require!(
            effect_type == EFFECT_TYPE_TRANSFER_SOL,
            OutcomeError::InvalidEffectType
        );
        require!(
            off + 7 <= blob.len(),
            OutcomeError::InvalidCompiledArtifactFormat
        );
        ensure_zero(&blob[off..off + 7])?;
        off += 7;
        let amount_lamports = read_u64_le(blob, &mut off)?;
        effects.push(ParsedEffect {
            effect_type,
            amount_lamports,
        });
    }

    require!(
        off == blob.len(),
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        referenced_effects.iter().all(|is_referenced| *is_referenced),
        OutcomeError::InvalidCompiledArtifactFormat
    );

    Ok(ParsedArtifact {
        header: ParsedHeader {
            format_version,
            min_input_lamports,
            max_input_lamports,
            outcome_count,
            total_effect_count,
            winners_count,
            formula_code,
            target_score,
        },
        outcomes,
        effects,
        effects_offset,
    })
}

pub fn select_outcomes(
    blob: &[u8],
    parsed: &ParsedArtifact,
    randomness: &[u8; 32],
    input_lamports: u64,
) -> Result<SelectedOutcomes> {
    require!(
        input_lamports >= parsed.header.min_input_lamports
            && input_lamports <= parsed.header.max_input_lamports,
        OutcomeError::InvalidInputAmount
    );

    let selected_indices = select_outcome_indices(parsed, randomness)?;
    let mut outcome_id_lens = Vec::with_capacity(parsed.header.winners_count as usize);
    let mut outcome_ids = Vec::with_capacity(parsed.header.winners_count as usize);
    let mut total_output_lamports = 0u64;
    let mut effect_count = 0u16;
    let mut effects_hasher = Sha256::new();

    for selected_index in selected_indices {
        let selected = parsed.outcomes[selected_index];
        let start =
            parsed.effects_offset + selected.first_effect_index as usize * EFFECT_ENTRY_BYTES;
        let end = start + selected.effect_count as usize * EFFECT_ENTRY_BYTES;
        effects_hasher.update(&blob[start..end]);

        outcome_id_lens.push(selected.outcome_id_len);
        outcome_ids.push(selected.outcome_id);
        effect_count = effect_count
            .checked_add(selected.effect_count)
            .ok_or(OutcomeError::MathOverflow)?;

        for effect in parsed
            .effects
            .iter()
            .skip(selected.first_effect_index as usize)
            .take(selected.effect_count as usize)
        {
            total_output_lamports = total_output_lamports
                .checked_add(effect.amount_lamports)
                .ok_or(OutcomeError::MathOverflow)?;
        }
    }

    Ok(SelectedOutcomes {
        total_output_lamports,
        outcome_id_lens,
        outcome_ids,
        effect_count,
        effects_digest: effects_hasher.finalize().into(),
    })
}

pub fn select_outcome(
    blob: &[u8],
    parsed: &ParsedArtifact,
    randomness: &[u8; 32],
    input_lamports: u64,
) -> Result<SelectedOutcome> {
    let selected = select_outcomes(blob, parsed, randomness, input_lamports)?;
    require!(
        selected.outcome_id_lens.len() == 1 && selected.outcome_ids.len() == 1,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    Ok(SelectedOutcome {
        total_output_lamports: selected.total_output_lamports,
        outcome_id_len: selected.outcome_id_lens[0],
        outcome_id: selected.outcome_ids[0],
        effect_count: selected.effect_count,
        effects_digest: selected.effects_digest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_effect(blob: &mut Vec<u8>, amount: u64) {
        blob.push(EFFECT_TYPE_TRANSFER_SOL);
        blob.extend_from_slice(&[0u8; 7]);
        blob.extend_from_slice(&amount.to_le_bytes());
    }

    fn demo_blob() -> Vec<u8> {
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.extend_from_slice(&FORMAT_VERSION_V1.to_le_bytes());
        blob.extend_from_slice(&10u64.to_le_bytes());
        blob.extend_from_slice(&1_000u64.to_le_bytes());
        blob.extend_from_slice(&2u16.to_le_bytes());
        blob.extend_from_slice(&2u16.to_le_bytes());
        blob.extend_from_slice(&[0u8; 8]);

        blob.push(6);
        let mut common = [0u8; MAX_OUTCOME_ID_BYTES];
        common[..6].copy_from_slice(b"common");
        blob.extend_from_slice(&common);
        blob.extend_from_slice(&700u32.to_le_bytes());
        blob.extend_from_slice(&0u16.to_le_bytes());
        blob.extend_from_slice(&1u16.to_le_bytes());

        blob.push(4);
        let mut rare = [0u8; MAX_OUTCOME_ID_BYTES];
        rare[..4].copy_from_slice(b"rare");
        blob.extend_from_slice(&rare);
        blob.extend_from_slice(&300u32.to_le_bytes());
        blob.extend_from_slice(&1u16.to_le_bytes());
        blob.extend_from_slice(&1u16.to_le_bytes());

        push_effect(&mut blob, 100);
        push_effect(&mut blob, 500);
        blob
    }

    fn demo_v3_blob(formula_code: u8, winners_count: u16, target_score: i64) -> Vec<u8> {
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.extend_from_slice(&FORMAT_VERSION_V3.to_le_bytes());
        blob.extend_from_slice(&10u64.to_le_bytes());
        blob.extend_from_slice(&1_000u64.to_le_bytes());
        blob.extend_from_slice(&3u16.to_le_bytes());
        blob.extend_from_slice(&3u16.to_le_bytes());
        blob.extend_from_slice(&winners_count.to_le_bytes());
        blob.push(formula_code);
        blob.extend_from_slice(&[0u8; 5]);
        blob.extend_from_slice(&target_score.to_le_bytes());

        let entries = [
            (b"alice".as_slice(), 1u32, 100i64, 1u16, 0u16, 1u16, 11u64),
            (b"bob".as_slice(), 1u32, 300i64, 0u16, 1u16, 1u16, 22u64),
            (b"carol".as_slice(), 1u32, 200i64, 2u16, 2u16, 1u16, 33u64),
        ];

        for (id, weight, score, order, first_effect_index, effect_count, _) in entries {
            blob.push(id.len() as u8);
            let mut padded = [0u8; MAX_OUTCOME_ID_BYTES];
            padded[..id.len()].copy_from_slice(id);
            blob.extend_from_slice(&padded);
            blob.extend_from_slice(&weight.to_le_bytes());
            blob.extend_from_slice(&score.to_le_bytes());
            blob.extend_from_slice(&order.to_le_bytes());
            blob.extend_from_slice(&first_effect_index.to_le_bytes());
            blob.extend_from_slice(&effect_count.to_le_bytes());
        }

        for (_, _, _, _, _, _, amount) in entries {
            push_effect(&mut blob, amount);
        }

        blob
    }

    #[test]
    fn parses_and_selects_deterministically() {
        let blob = demo_blob();
        let parsed = parse(&blob).unwrap();
        let selected = select_outcome(&blob, &parsed, &[0u8; 32], 10).unwrap();
        assert_eq!(selected.outcome_id_len, 6);
        assert_eq!(
            outcome_id_bytes(&selected.outcome_id, selected.outcome_id_len),
            b"common"
        );
        assert_eq!(selected.total_output_lamports, 100);

        let mut randomness = [0u8; 32];
        randomness[..8].copy_from_slice(&999u64.to_le_bytes());
        let selected = select_outcome(&blob, &parsed, &randomness, 10).unwrap();
        assert_eq!(
            outcome_id_bytes(&selected.outcome_id, selected.outcome_id_len),
            b"rare"
        );
        assert_eq!(selected.total_output_lamports, 500);
    }

    #[test]
    fn parses_v3_rank_desc_and_respects_order_tiebreak() {
        let blob = demo_v3_blob(FORMULA_RANK_DESC, 2, 0);
        let parsed = parse(&blob).unwrap();
        let selected = select_outcomes(&blob, &parsed, &[0u8; 32], 10).unwrap();
        assert_eq!(parsed.header.formula_code, FORMULA_RANK_DESC);
        assert_eq!(parsed.header.target_score, 0);
        assert_eq!(outcome_id_bytes(&selected.outcome_ids[0], selected.outcome_id_lens[0]), b"bob");
        assert_eq!(
            outcome_id_bytes(&selected.outcome_ids[1], selected.outcome_id_lens[1]),
            b"carol"
        );
        assert_eq!(selected.total_output_lamports, 55);
    }

    #[test]
    fn parses_v3_closest_to_with_i128_distance() {
        let blob = demo_v3_blob(FORMULA_CLOSEST_TO, 2, 210);
        let parsed = parse(&blob).unwrap();
        let selected = select_outcomes(&blob, &parsed, &[0u8; 32], 10).unwrap();
        assert_eq!(
            outcome_id_bytes(&selected.outcome_ids[0], selected.outcome_id_lens[0]),
            b"carol"
        );
        assert_eq!(
            outcome_id_bytes(&selected.outcome_ids[1], selected.outcome_id_lens[1]),
            b"bob"
        );
    }

    #[test]
    fn parses_v3_first_n_by_order() {
        let blob = demo_v3_blob(FORMULA_FIRST_N, 2, 0);
        let parsed = parse(&blob).unwrap();
        let selected = select_outcomes(&blob, &parsed, &[0u8; 32], 10).unwrap();
        assert_eq!(
            outcome_id_bytes(&selected.outcome_ids[0], selected.outcome_id_lens[0]),
            b"bob"
        );
        assert_eq!(
            outcome_id_bytes(&selected.outcome_ids[1], selected.outcome_id_lens[1]),
            b"alice"
        );
    }

    #[test]
    fn rejects_unsorted_outcome_ids() {
        let mut blob = demo_blob();
        let offset = 4 + 2 + 8 + 8 + 2 + 2 + 8 + 1 + MAX_OUTCOME_ID_BYTES + 4 + 2 + 2;
        blob[offset] = 6;
        blob[offset + 1..offset + 1 + 6].copy_from_slice(b"aaaaaa");
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_duplicate_v3_order() {
        let mut blob = demo_v3_blob(FORMULA_RANK_DESC, 1, 0);
        let first_order_offset = HEADER_BYTES_V3 + 1 + MAX_OUTCOME_ID_BYTES + 4 + 8;
        let second_order_offset =
            HEADER_BYTES_V3 + (1 + MAX_OUTCOME_ID_BYTES + 4 + 8 + 2 + 2 + 2) + 1 + MAX_OUTCOME_ID_BYTES + 4 + 8;
        blob[first_order_offset..first_order_offset + 2].copy_from_slice(&0u16.to_le_bytes());
        blob[second_order_offset..second_order_offset + 2].copy_from_slice(&0u16.to_le_bytes());
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut blob = demo_blob();
        blob.push(1);
        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_orphan_effect_entries() {
        let mut blob = demo_blob();
        blob[24..26].copy_from_slice(&3u16.to_le_bytes());

        push_effect(&mut blob, 42);

        assert!(parse(&blob).is_err());
    }

    #[test]
    fn rejects_truncated_effect_reserved_bytes_without_panicking() {
        let mut blob = demo_blob();
        let effects_offset =
            4 + 2 + 8 + 8 + 2 + 2 + 8 + (1 + MAX_OUTCOME_ID_BYTES + 4 + 2 + 2) * 2;
        blob.truncate(effects_offset + 1 + 3);

        let result = std::panic::catch_unwind(|| parse(&blob));

        assert!(result.is_ok());
        assert!(result.unwrap().is_err());
    }

    #[test]
    fn rejects_truncated_header_reserved_bytes_without_panicking() {
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.extend_from_slice(&FORMAT_VERSION_V1.to_le_bytes());
        blob.extend_from_slice(&10u64.to_le_bytes());
        blob.extend_from_slice(&1_000u64.to_le_bytes());
        blob.extend_from_slice(&1u16.to_le_bytes());
        blob.extend_from_slice(&1u16.to_le_bytes());
        blob.extend_from_slice(&[0u8; 3]);

        let result = std::panic::catch_unwind(|| parse(&blob));

        assert!(result.is_ok());
        assert!(result.unwrap().is_err());
    }
}
