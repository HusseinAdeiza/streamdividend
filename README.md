# StreamDividend — Program

On-chain dividend-streaming vault for tokenized stocks on Solana.

A share-based vault that holds a tokenized stock (e.g. **AAPLx**, Token-2022) and
reinvests/pays its **USDC** dividends pro-rata to depositors, who can deposit,
withdraw shares at any time, and claim accrued USDC dividends.

## Live on mainnet-beta

| | |
|---|---|
| Program ID | `LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA` |
| Vault PDA | `2vsxDXuanJxrWtBzhun6yaCidHZxVNdFEobtAC3CKwM2` |
| Vault xStock ATA (AAPLx, Token-2022) | `E4qLqRdxvv1HTAS7gePCq9JMaNhE1BpXh3WUEJjezpsk` |
| Vault USDC ATA | `3khNwQmsAwXaeLZe4dWGtpEfs7FjQpjEqhPjZyeGydQg` |
| xStock mint | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` (AAPLx, Token-2022) |
| USDC mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (v3) |

Full deployment record: [`MAINNET.md`](MAINNET.md).

## Instructions

| Instruction | What it does |
|---|---|
| `initialize` | Create the vault account + vault token ATAs (idempotent ATA creation is done client-side) |
| `deposit` | Deposit xStock shares → mint vault shares at the current ratio |
| `trigger_dividend` | Transfer USDC dividends into the vault pool |
| `claim_dividend` | Pay the caller their accrued USDC (`dividendsPerShare − lastDps`) and return the vault's xStock for withdrawn share value |
| `withdraw` | Burn vault shares → return xStock at the current ratio |

## Accounts

- `vault` — PDA `["vault", authority]`: holds `total_shares`, `total_xstock`
  (pool balance, raw u64), `dividends_per_share` (u128, per-share raw USDC
  including 6-decimal scale), `pool` (USDC pool balance).
- Vault token ATAs are derived with `allowOwnerOffCurve = true` (vault is a PDA).

## Build

```sh
cargo build-sbf
anchor idl --program programs/streamdividend/src/lib.rs --write-idl target/idl/streamdividend.json
```

## Local e2e

Requires a running `solana-test-validator`. Uses a **real Token-2022 xStock
mint** (matching AAPLx) and a v3 USDC mint; both invariants are asserted:

```sh
solana-test-validator --ledger /tmp/e2e_ledger --reset &
solana program deploy target/deploy/streamdividend.so --url localhost
node test_program.js   # expect: 8/8 steps passed
```

## Files

- `programs/streamdividend/src/` — `lib.rs` (handlers), `token_ix.rs` (SPL token CPI helpers)
- `test_program.js` — end-to-end local test
- `setup_mainnet_vault.js` — mainnet vault setup (ATA creation + initialize)
- `target/idl/streamdividend.json` — generated IDL (consumed by the web app)
