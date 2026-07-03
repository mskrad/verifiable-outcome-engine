//! Manual byte-layout parsing of the BPF upgradeable loader's
//! `UpgradeableLoaderState` (bincode fixed-int LE; frozen on-chain ABI):
//!
//!   Program     = tag 2u32 ‖ programdata_address: Pubkey                   (36 bytes)
//!   ProgramData = tag 3u32 ‖ slot: u64 ‖ upgrade_authority: Option<Pubkey> (45-byte header)
//!
//! Replaces `Program::programdata_address()` / `Account<ProgramData>`, whose
//! serde/bincode deserialization links ~50 KB into the .so.

use anchor_lang::error::ErrorCode;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

const PROGRAM_TAG: [u8; 4] = 2u32.to_le_bytes();
const PROGRAM_DATA_TAG: [u8; 4] = 3u32.to_le_bytes();

/// Mirrors `anchor_lang::accounts::program::Program::programdata_address`:
/// `None` when the account is not owned by the upgradeable loader, error when
/// the data does not parse as `UpgradeableLoaderState::Program`.
pub fn programdata_address(program: &AccountInfo) -> Result<Option<Pubkey>> {
    if *program.owner != bpf_loader_upgradeable::ID {
        return Ok(None);
    }
    let data = program.try_borrow_data()?;
    let addr = parse_program(&data).ok_or_else(|| error!(ErrorCode::AccountDidNotDeserialize))?;
    Ok(Some(addr))
}

/// Mirrors the checks of `Account<'info, ProgramData>` (owner + state variant)
/// and returns `UpgradeableLoaderState::ProgramData.upgrade_authority_address`.
pub fn upgrade_authority(program_data: &AccountInfo) -> Result<Option<Pubkey>> {
    if *program_data.owner != bpf_loader_upgradeable::ID {
        return Err(error!(ErrorCode::AccountOwnedByWrongProgram));
    }
    let data = program_data.try_borrow_data()?;
    parse_program_data_authority(&data).ok_or_else(|| error!(ErrorCode::AccountDidNotDeserialize))
}

fn parse_program(data: &[u8]) -> Option<Pubkey> {
    if data.len() < 36 || data[0..4] != PROGRAM_TAG {
        return None;
    }
    Some(Pubkey::new_from_array(data[4..36].try_into().ok()?))
}

fn parse_program_data_authority(data: &[u8]) -> Option<Option<Pubkey>> {
    if data.len() < 45 || data[0..4] != PROGRAM_DATA_TAG {
        return None;
    }
    match data[12] {
        0 => Some(None),
        1 => Some(Some(Pubkey::new_from_array(data[13..45].try_into().ok()?))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bincode_program(addr: &Pubkey) -> Vec<u8> {
        let mut v = vec![2, 0, 0, 0];
        v.extend_from_slice(addr.as_ref());
        v
    }

    fn bincode_program_data(slot: u64, authority: Option<&Pubkey>) -> Vec<u8> {
        let mut v = vec![3, 0, 0, 0];
        v.extend_from_slice(&slot.to_le_bytes());
        match authority {
            None => v.push(0),
            Some(pk) => {
                v.push(1);
                v.extend_from_slice(pk.as_ref());
            }
        }
        // ProgramData accounts carry the ELF after the 45-byte header.
        v.extend_from_slice(&[0xAA; 64]);
        v
    }

    #[test]
    fn parses_program_variant() {
        let addr = Pubkey::new_unique();
        assert_eq!(parse_program(&bincode_program(&addr)), Some(addr));
        assert_eq!(parse_program(&[2, 0, 0, 0]), None); // truncated
        assert_eq!(parse_program(&bincode_program_data(7, None)), None); // wrong tag
    }

    #[test]
    fn parses_program_data_authority() {
        let auth = Pubkey::new_unique();
        assert_eq!(
            parse_program_data_authority(&bincode_program_data(42, Some(&auth))),
            Some(Some(auth))
        );
        assert_eq!(
            parse_program_data_authority(&bincode_program_data(42, None)),
            Some(None)
        );
        assert_eq!(parse_program_data_authority(&[3, 0, 0, 0]), None); // truncated
        let mut bad = bincode_program_data(42, Some(&auth));
        bad[12] = 2; // invalid Option tag
        assert_eq!(parse_program_data_authority(&bad), None);
        assert_eq!(
            parse_program_data_authority(&bincode_program(&auth)),
            None // wrong tag
        );
    }
}
