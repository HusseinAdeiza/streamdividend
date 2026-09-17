//! Hand-built SPL Token / Token-2022 instruction builders.
//!
//! Same wire format on both programs, so one builder serves Token-v3 and
//! Token-2022. Deliberately tiny (no borsh enum, no spl-token dependency) to
//! keep the SBF binary small — deploy rent is charged on program size.
//!
//! Data layout (bincode-style SPL `TokenInstruction`):
//!   TransferChecked    = [12,     amount: u64 LE, decimals: u8]
//!   InitializeAccount3 = [18,     owner: [u8; 32]]   (v3 init only)
//!
//! NOTE: we must use TransferChecked (not plain Transfer): Token-2022 mints
//! with extensions (e.g. real AAPLx — confidentialTransferMint,
//! permanentDelegate, tokenMetadata, pausable) reject plain `Transfer` with
//! "Mint required for this account to transfer tokens, use transfer_checked".
//! TransferChecked is valid on both Token-v3 and Token-2022.
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey;
use solana_program::pubkey::Pubkey;

pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// SPL Token account base data length (identical for v3 and Token-2022).
pub const TOKEN_ACCOUNT_DATA_LEN: u64 = 165;

/// `TransferChecked` (SPL instruction 12): moves `amount` from `from` to `to`,
/// verified against `mint`'s decimals. Account order (SPL canonical):
///   from (w), mint (r), to (w), authority (signer).
pub fn transfer_checked(
    program_id: &Pubkey,
    from: &Pubkey,
    to: &Pubkey,
    mint: &Pubkey,
    authority: &Pubkey,
    amount: u64,
    decimals: u8,
) -> Instruction {
    let mut data = Vec::with_capacity(10);
    data.push(12u8);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*from, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*to, false),
            // Authority must be is_signer=true: for a CPI instruction the token
            // program only sees it as signed if its meta says so (a real signer
            // matches the top-level tx signature; a PDA is proven via
            // invoke_signed signer_seeds).
            AccountMeta::new(*authority, true),
        ],
        data,
    }
}

pub fn initialize_account3(program_id: &Pubkey, account: &Pubkey, mint: &Pubkey, owner: &Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(33);
    data.push(18u8);
    data.extend_from_slice(&owner.to_bytes());
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*account, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(*owner, false),
        ],
        data,
    }
}
