//! Hand-built SPL Token / Token-2022 instruction builders.
//!
//! Same wire format on both programs, so one builder serves Token-v3 and
//! Token-2022. Deliberately tiny (no borsh enum, no spl-token dependency) to
//! keep the SBF binary small — deploy rent is charged on program size.
//!
//! Data layout (bincode-style SPL `TokenInstruction`):
//!   Transfer           = [3,      amount: u64 LE]
//!   InitializeAccount3 = [18,     owner: [u8; 32]]
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey;
use solana_program::pubkey::Pubkey;

pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// SPL Token account base data length (identical for v3 and Token-2022).
pub const TOKEN_ACCOUNT_DATA_LEN: u64 = 165;

pub fn transfer(
    program_id: &Pubkey,
    from: &Pubkey,
    to: &Pubkey,
    authority: &Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = Vec::with_capacity(9);
    data.push(3u8);
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*from, false),
            AccountMeta::new(*to, false),
            // Authority must be is_signer=true: for a CPI instruction the token
            // program only sees it as signed if its meta says so (a real signer
            // matches the top-level tx signature; a PDA is proven via
            // invoke_signed signer_seeds).
            AccountMeta::new(*authority, true),
            // SPL Token Transfer requires the token program as the 4th account.
            AccountMeta::new_readonly(*program_id, false),
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
