use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::errors::OutcomeError;

pub const MAGIC: &[u8; 4] = b"W3O1";
pub const FORMAT_VERSION_V1: u16 = 1;
pub const MAX_COMPILED_ARTIFACT_BYTES: usize = 8192;
pub const MAX_OUTCOME_ID_BYTES: usize = 64;
pub const EFFECT_ENTRY_BYTES: usize = 16;
pub const EFFECT_TYPE_TRANSFER_SOL: u8 = 1;

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParsedHeader {
    pub format_version: u16,
    pub min_input_lamports: u64,
    pub max_input_lamports: u64,
    pub outcome_count: u16,
    pub total_effect_count: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParsedOutcome {
    pub outcome_id_len: u8,
    pub outcome_id: [u8; MAX_OUTCOME_ID_BYTES],
    pub weight: u32,
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

pub fn parse(blob: &[u8]) -> Result<ParsedArtifact> {
    require!(
        !blob.is_empty() && blob.len() <= MAX_COMPILED_ARTIFACT_BYTES,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        blob.len() >= 26,
        OutcomeError::InvalidCompiledArtifactFormat
    );
    require!(
        &blob[..4] == MAGIC,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let mut off = 4usize;
    let format_version = read_u16_le(blob, &mut off)?;
    require!(
        format_version == FORMAT_VERSION_V1,
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
    let reserved = &blob[off..off + 8];
    ensure_zero(reserved)?;
    off += 8;

    require!(
        outcome_count > 0,
        OutcomeError::InvalidCompiledArtifactFormat
    );

    let mut outcomes = Vec::with_capacity(outcome_count as usize);
    let mut referenced_effects = vec![false; total_effect_count as usize];
    let mut previous_id: Option<Vec<u8>> = None;
    let mut weight_sum = 0u64;

    for _ in 0..outcome_count {
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
            referenced_effects[effect_index] = true;
        }

        outcomes.push(ParsedOutcome {
            outcome_id_len,
            outcome_id,
            weight,
            first_effect_index,
            effect_count,
        });
    }

    require!(weight_sum > 0, OutcomeError::InvalidCompiledArtifactFormat);

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
        referenced_effects
            .iter()
            .all(|is_referenced| *is_referenced),
        OutcomeError::InvalidCompiledArtifactFormat
    );

    Ok(ParsedArtifact {
        header: ParsedHeader {
            format_version,
            min_input_lamports,
            max_input_lamports,
            outcome_count,
            total_effect_count,
        },
        outcomes,
        effects,
        effects_offset,
    })
}

pub fn select_outcome(
    blob: &[u8],
    parsed: &ParsedArtifact,
    randomness: &[u8; 32],
    input_lamports: u64,
) -> Result<SelectedOutcome> {
    require!(
        input_lamports >= parsed.header.min_input_lamports
            && input_lamports <= parsed.header.max_input_lamports,
        OutcomeError::InvalidInputAmount
    );

    let rolled = u64::from_le_bytes(randomness[..8].try_into().unwrap());
    let weights: Vec<u32> = parsed
        .outcomes
        .iter()
        .map(|outcome| outcome.weight)
        .collect();
    let selected_index = choose_weighted_index(&weights, rolled)?;
    let selected = parsed.outcomes[selected_index];

    let start = parsed.effects_offset + selected.first_effect_index as usize * EFFECT_ENTRY_BYTES;
    let end = start + selected.effect_count as usize * EFFECT_ENTRY_BYTES;
    let effects_digest = sha256(&blob[start..end]);

    let mut total_output_lamports = 0u64;
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

    Ok(SelectedOutcome {
        total_output_lamports,
        outcome_id_len: selected.outcome_id_len,
        outcome_id: selected.outcome_id,
        effect_count: selected.effect_count,
        effects_digest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

        blob.push(EFFECT_TYPE_TRANSFER_SOL);
        blob.extend_from_slice(&[0u8; 7]);
        blob.extend_from_slice(&100u64.to_le_bytes());

        blob.push(EFFECT_TYPE_TRANSFER_SOL);
        blob.extend_from_slice(&[0u8; 7]);
        blob.extend_from_slice(&500u64.to_le_bytes());
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
    fn rejects_unsorted_outcome_ids() {
        let mut blob = demo_blob();
        let offset = 4 + 2 + 8 + 8 + 2 + 2 + 8 + 1 + MAX_OUTCOME_ID_BYTES + 4 + 2 + 2;
        blob[offset] = 6;
        blob[offset + 1..offset + 1 + 6].copy_from_slice(b"aaaaaa");
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

        blob.push(EFFECT_TYPE_TRANSFER_SOL);
        blob.extend_from_slice(&[0u8; 7]);
        blob.extend_from_slice(&42u64.to_le_bytes());

        assert!(parse(&blob).is_err());
    }
}
