use anchor_lang::prelude::*;

use crate::errors::OutcomeError;

pub const FORMAT_VERSION_COMPOSITE_RANK_DESC: u16 = 8;
pub const FORMULA_CODE_COMPOSITE_RANK_DESC: u8 = 6;
pub const COMPOSITE_WEIGHT_SCALE: u32 = 1_000_000;
pub const COMPOSITE_NORMALIZATION_SCALE: i128 = 1_000_000;
pub const MAX_COMPOSITE_FIELDS: usize = 16;
pub const MAX_COMPOSITE_FIELD_KEY_BYTES: usize = 32;
pub const MAX_COMPOSITE_PARTICIPANT_ID_BYTES: usize = 64;
pub const MAX_COMPOSITE_ARTIFACT_BYTES: usize = 8192;
const MAGIC: &[u8; 4] = b"W3O1";
const HEADER_BYTES: usize = 46;
const FIELD_SPEC_BYTES: usize = 1 + MAX_COMPOSITE_FIELD_KEY_BYTES + 4;
const MAX_WINNERS: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompositeNormalizationMode {
    None,
    MinMax,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedCompositeField {
    pub key: String,
    pub weight_ppm: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedCompositeParticipant {
    pub id: String,
    pub order: u16,
    pub field_values: Vec<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedCompositeRankDescArtifact {
    pub format_version: u16,
    pub min_input_lamports: u64,
    pub max_input_lamports: u64,
    pub winners_count: u16,
    pub normalization_mode: CompositeNormalizationMode,
    pub participant_count: u16,
    pub payout_lamports: u64,
    pub weight_scale: u32,
    pub normalization_scale: i128,
    pub scoring_fields: Vec<ParsedCompositeField>,
    pub participants: Vec<ParsedCompositeParticipant>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompositeFieldReplay {
    pub field: String,
    pub raw_value: i64,
    pub effective_value: i128,
    pub min_value: i64,
    pub max_value: i64,
    pub contribution: i128,
    pub zero_ordering_power: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompositeReplayEntry {
    pub id: String,
    pub order: u16,
    pub composite_score: i128,
    pub field_replay: Vec<CompositeFieldReplay>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompositeReplayResult {
    pub winner_ids: Vec<String>,
    pub ordered_ids: Vec<String>,
    pub participant_replay: Vec<CompositeReplayEntry>,
}

fn invalid_format<T>() -> Result<T> {
    Err(error!(OutcomeError::InvalidCompiledArtifactFormat))
}

fn read_u8(input: &[u8], off: &mut usize) -> Result<u8> {
    if *off + 1 > input.len() {
        return invalid_format();
    }
    let value = input[*off];
    *off += 1;
    Ok(value)
}

fn read_u16_le(input: &[u8], off: &mut usize) -> Result<u16> {
    if *off + 2 > input.len() {
        return invalid_format();
    }
    let value = u16::from_le_bytes([input[*off], input[*off + 1]]);
    *off += 2;
    Ok(value)
}

fn read_u32_le(input: &[u8], off: &mut usize) -> Result<u32> {
    if *off + 4 > input.len() {
        return invalid_format();
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
        return invalid_format();
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
        return invalid_format();
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

fn read_bytes<'a>(input: &'a [u8], off: &mut usize, len: usize) -> Result<&'a [u8]> {
    if *off + len > input.len() {
        return invalid_format();
    }
    let out = &input[*off..*off + len];
    *off += len;
    Ok(out)
}

fn ensure_zero(bytes: &[u8]) -> Result<()> {
    require!(
        bytes.iter().all(|byte| *byte == 0),
        OutcomeError::InvalidReservedBytes
    );
    Ok(())
}

fn ensure_printable_ascii(bytes: &[u8]) -> Result<()> {
    require!(
        bytes.iter().all(|byte| (32..=126).contains(byte)),
        OutcomeError::InvalidOutcomeId
    );
    Ok(())
}

fn ensure_field_key(bytes: &[u8]) -> Result<()> {
    require!(!bytes.is_empty(), OutcomeError::InvalidCompiledArtifactFormat);
    let first = bytes[0];
    require!(first.is_ascii_lowercase(), OutcomeError::InvalidCompiledArtifactFormat);
    for byte in &bytes[1..] {
        require!(
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_',
            OutcomeError::InvalidCompiledArtifactFormat
        );
    }
    Ok(())
}

fn normalization_mode_from_code(code: u8) -> Result<CompositeNormalizationMode> {
    match code {
        0 => Ok(CompositeNormalizationMode::None),
        1 => Ok(CompositeNormalizationMode::MinMax),
        _ => invalid_format(),
    }
}

fn participant_bytes_per_entry(field_count: usize) -> usize {
    1 + MAX_COMPOSITE_PARTICIPANT_ID_BYTES + 2 + field_count * 8
}

pub fn parse(blob: &[u8]) -> Result<ParsedCompositeRankDescArtifact> {
    require!(
        blob.len() >= HEADER_BYTES && blob.len() <= MAX_COMPOSITE_ARTIFACT_BYTES,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(&blob[..4] == MAGIC, OutcomeError::InvalidCompiledArtifactFormat);

    let mut off = 4usize;
    let format_version = read_u16_le(blob, &mut off)?;
    require!(
        format_version == FORMAT_VERSION_COMPOSITE_RANK_DESC,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    let min_input_lamports = read_u64_le(blob, &mut off)?;
    let max_input_lamports = read_u64_le(blob, &mut off)?;
    require!(
        min_input_lamports <= max_input_lamports,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    let winners_count = read_u16_le(blob, &mut off)?;
    let formula_code = read_u8(blob, &mut off)?;
    require!(
        formula_code == FORMULA_CODE_COMPOSITE_RANK_DESC,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    let normalization_mode = normalization_mode_from_code(read_u8(blob, &mut off)?)?;
    let field_count = read_u8(blob, &mut off)? as usize;
    require!(
        (1..=MAX_COMPOSITE_FIELDS).contains(&field_count),
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(read_u8(blob, &mut off)? == 0, OutcomeError::InvalidReservedBytes);
    let weight_scale = read_u32_le(blob, &mut off)?;
    let normalization_scale = read_u32_le(blob, &mut off)? as i128;
    let participant_count = read_u16_le(blob, &mut off)?;
    let payout_lamports = read_u64_le(blob, &mut off)?;
    require!(
        weight_scale == COMPOSITE_WEIGHT_SCALE,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        normalization_scale == COMPOSITE_NORMALIZATION_SCALE,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(participant_count > 0, OutcomeError::InvalidCompiledArtifactFormat);
    require!(
        winners_count > 0
            && winners_count <= participant_count
            && winners_count as usize <= MAX_WINNERS,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let expected_len = HEADER_BYTES
        + field_count * FIELD_SPEC_BYTES
        + participant_count as usize * participant_bytes_per_entry(field_count);
    require!(
        expected_len == blob.len(),
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let mut weight_sum = 0u64;
    let mut scoring_fields = Vec::with_capacity(field_count);
    let mut previous_key: Option<String> = None;
    for _ in 0..field_count {
        let key_len = read_u8(blob, &mut off)? as usize;
        require!(
            (1..=MAX_COMPOSITE_FIELD_KEY_BYTES).contains(&key_len),
            OutcomeError::InvalidCompiledArtifactFormat
        );
        let key_bytes = read_bytes(blob, &mut off, MAX_COMPOSITE_FIELD_KEY_BYTES)?;
        ensure_zero(&key_bytes[key_len..])?;
        let key_slice = &key_bytes[..key_len];
        ensure_field_key(key_slice)?;
        let key = std::str::from_utf8(key_slice)
            .map_err(|_| error!(OutcomeError::InvalidCompiledArtifactFormat))?
            .to_string();
        if let Some(previous) = &previous_key {
            require!(previous != &key, OutcomeError::InvalidCompiledArtifactFormat);
        }
        previous_key = Some(key.clone());
        let weight_ppm = read_u32_le(blob, &mut off)?;
        require!(weight_ppm > 0, OutcomeError::InvalidCompiledArtifactFormat);
        weight_sum = weight_sum
            .checked_add(weight_ppm as u64)
            .ok_or(OutcomeError::MathOverflow)?;
        scoring_fields.push(ParsedCompositeField { key, weight_ppm });
    }
    require!(
        weight_sum == COMPOSITE_WEIGHT_SCALE as u64,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let mut participants = Vec::with_capacity(participant_count as usize);
    let mut previous_id: Option<Vec<u8>> = None;
    let mut seen_orders = std::collections::BTreeSet::new();
    for _ in 0..participant_count {
        let id_len = read_u8(blob, &mut off)? as usize;
        require!(
            (1..=MAX_COMPOSITE_PARTICIPANT_ID_BYTES).contains(&id_len),
            OutcomeError::InvalidOutcomeId
        );
        let id_bytes = read_bytes(blob, &mut off, MAX_COMPOSITE_PARTICIPANT_ID_BYTES)?;
        ensure_zero(&id_bytes[id_len..])?;
        let id_slice = &id_bytes[..id_len];
        ensure_printable_ascii(id_slice)?;
        let current_id = id_slice.to_vec();
        if let Some(previous) = &previous_id {
            require!(previous < &current_id, OutcomeError::InvalidOutcomeId);
        }
        previous_id = Some(current_id);
        let order = read_u16_le(blob, &mut off)?;
        require!(
            seen_orders.insert(order),
            OutcomeError::InvalidCompiledArtifactFormat
        );
        let mut field_values = Vec::with_capacity(field_count);
        for _ in 0..field_count {
            field_values.push(read_i64_le(blob, &mut off)?);
        }
        participants.push(ParsedCompositeParticipant {
            id: std::str::from_utf8(id_slice)
                .map_err(|_| error!(OutcomeError::InvalidOutcomeId))?
                .to_string(),
            order,
            field_values,
        });
    }

    Ok(ParsedCompositeRankDescArtifact {
        format_version,
        min_input_lamports,
        max_input_lamports,
        winners_count,
        normalization_mode,
        participant_count,
        payout_lamports,
        weight_scale,
        normalization_scale,
        scoring_fields,
        participants,
    })
}

fn field_range(participants: &[ParsedCompositeParticipant], field_index: usize) -> (i64, i64) {
    let mut min = participants[0].field_values[field_index];
    let mut max = participants[0].field_values[field_index];
    for participant in participants {
        let value = participant.field_values[field_index];
        if value < min {
            min = value;
        }
        if value > max {
            max = value;
        }
    }
    (min, max)
}

fn effective_value(
    mode: CompositeNormalizationMode,
    raw_value: i64,
    min_value: i64,
    max_value: i64,
) -> (i128, bool) {
    match mode {
        CompositeNormalizationMode::None => (raw_value as i128, false),
        CompositeNormalizationMode::MinMax => {
            if max_value == min_value {
                return (0, true);
            }
            let numerator = (raw_value as i128 - min_value as i128) * COMPOSITE_NORMALIZATION_SCALE;
            let denominator = max_value as i128 - min_value as i128;
            (numerator / denominator, false)
        }
    }
}

pub fn replay(blob: &[u8]) -> Result<CompositeReplayResult> {
    let parsed = parse(blob)?;
    let ranges: Vec<(i64, i64)> = (0..parsed.scoring_fields.len())
        .map(|index| field_range(&parsed.participants, index))
        .collect();

    let mut entries = Vec::with_capacity(parsed.participants.len());
    for participant in &parsed.participants {
        let mut composite_score = 0i128;
        let mut field_replay = Vec::with_capacity(parsed.scoring_fields.len());
        for (field_index, field) in parsed.scoring_fields.iter().enumerate() {
            let raw_value = participant.field_values[field_index];
            let (min_value, max_value) = ranges[field_index];
            let (effective, zero_ordering_power) =
                effective_value(parsed.normalization_mode, raw_value, min_value, max_value);
            let contribution = effective * field.weight_ppm as i128;
            composite_score = composite_score
                .checked_add(contribution)
                .ok_or(OutcomeError::MathOverflow)?;
            field_replay.push(CompositeFieldReplay {
                field: field.key.clone(),
                raw_value,
                effective_value: effective,
                min_value,
                max_value,
                contribution,
                zero_ordering_power,
            });
        }
        entries.push(CompositeReplayEntry {
            id: participant.id.clone(),
            order: participant.order,
            composite_score,
            field_replay,
        });
    }

    entries.sort_by(|left, right| {
        right
            .composite_score
            .cmp(&left.composite_score)
            .then(left.order.cmp(&right.order))
            .then_with(|| left.id.cmp(&right.id))
    });

    let ordered_ids = entries.iter().map(|entry| entry.id.clone()).collect::<Vec<_>>();
    let winner_ids = entries
        .iter()
        .take(parsed.winners_count as usize)
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();

    Ok(CompositeReplayResult {
        winner_ids,
        ordered_ids,
        participant_replay: entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn case_path(case_id: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/composite_rank_desc")
            .join(format!("{case_id}.bin"))
    }

    fn load_case(case_id: &str) -> Vec<u8> {
        std::fs::read(case_path(case_id)).expect("case artifact must exist; generate via TS script first")
    }

    #[test]
    fn normalized_composite_ranking_matches_fixture() {
        let blob = load_case("normalized_composite_ranking");
        let replay = replay(&blob).expect("replay should pass");
        assert_eq!(replay.winner_ids, vec!["desk_gamma", "desk_alpha"]);
        assert_eq!(
            replay.ordered_ids,
            vec!["desk_gamma", "desk_alpha", "desk_beta"]
        );
    }

    #[test]
    fn max_equals_min_sets_zero_ordering_power() {
        let blob = load_case("max_equals_min");
        let replay = replay(&blob).expect("replay should pass");
        assert_eq!(replay.winner_ids, vec!["wallet_c", "wallet_a"]);
        for entry in replay.participant_replay {
            let tier = entry
                .field_replay
                .iter()
                .find(|field| field.field == "tier")
                .expect("tier field must exist");
            assert_eq!(tier.effective_value, 0);
            assert_eq!(tier.contribution, 0);
            assert!(tier.zero_ordering_power);
        }
    }

    #[test]
    fn stable_tie_break_uses_order_asc() {
        let blob = load_case("stable_tie_break_by_order_asc");
        let replay = replay(&blob).expect("replay should pass");
        assert_eq!(replay.winner_ids, vec!["trader_top", "trader_early"]);
        assert_eq!(
            replay.ordered_ids,
            vec!["trader_top", "trader_early", "trader_late"]
        );
    }

    #[test]
    fn invalid_weight_sum_is_rejected() {
        let mut blob = load_case("normalized_composite_ranking");
        let weight_offset = HEADER_BYTES + 1 + MAX_COMPOSITE_FIELD_KEY_BYTES;
        blob[weight_offset..weight_offset + 4].copy_from_slice(&600_001u32.to_le_bytes());
        let error = parse(&blob).expect_err("invalid weight sum must fail");
        assert_eq!(error, error!(OutcomeError::InvalidCompiledArtifactFormat));
    }

    #[test]
    fn invalid_field_key_is_rejected() {
        let mut blob = load_case("normalized_composite_ranking");
        let key_offset = HEADER_BYTES + 1;
        blob[key_offset] = b'P';
        let error = parse(&blob).expect_err("invalid field key must fail");
        assert_eq!(error, error!(OutcomeError::InvalidCompiledArtifactFormat));
    }

    #[test]
    fn unsupported_field_count_is_rejected() {
        let mut blob = load_case("normalized_composite_ranking");
        let field_count_offset = 4 + 2 + 8 + 8 + 2 + 1 + 1;
        blob[field_count_offset] = (MAX_COMPOSITE_FIELDS + 1) as u8;
        let error = parse(&blob).expect_err("field count overflow must fail");
        assert_eq!(error, error!(OutcomeError::InvalidCompiledArtifactFormat));
    }
}
