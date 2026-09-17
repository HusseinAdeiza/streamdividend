# StreamDividend — MAINNET LIVE (2026-09-16)

## Program
- **Program ID:** `LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA`
- Size: 305,384 bytes
- ProgramData: `3EVmVdXM8WoMZG2jd527Wn4Vhmm222RXLTfnRthszCYw` (1.552 SOL rent, **recoverable** via close)
- Upgrade authority: `4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi`

## Deployer / vault authority wallet
- `4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi`
- Keyfile: `~/.config/solana/id.json` (NOT `target/deploy/streamdividend-keypair.json` — that's the program ID keypair, a different key)
- Balance after deploy: ~0.06 SOL (covers vault init + fees)

## Vault (live)
- **Vault PDA:** `2vsxDXuanJxrWtBzhun6yaCidHZxVNdFEobtAC3CKwM2`
- xstock_mint (AAPLx, Token-2022): `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`
- dividend_mint (USDC, v3): `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- vault AAPLx ATA (T2022, off-curve PDA owner): `E4qLqRdxvv1HTAS7gePCq9JMaNhE1BpXh3WUEJjezpsk`
- vault USDC ATA (v3, off-curve PDA owner): `3khNwQmsAwXaeLZe4dWGtpEfs7FjQpjEqhPjZyeGydQg`
- authority: `4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi`
- totalShares: 0, dividendsPerShare: 0 (empty, ready for first deposit)

## Mainnet ATA creation signatures (for the record)
- vault AAPLx ATA: `4xn1gt6W143UB4kf45vTAJZcGZz5AEPMzYb52nKQgHgYaB2nfukwoFN7VntYHUsTtePSfTQChyWcAzxaaDQbTwG2`
- vault USDC ATA: `34uQAixanw46WNinELYBDaT27kpZ5ANH2xJfVbma3Db6M2G9oiAxkpMv8UgNNsmKpif3KcUNoy8gZDzKpgtP3DLs`

## Real program bugs found & fixed during local e2e (all in the deployed binary)
1. `token_account_mint` read bytes 32..64 (owner) instead of 0..32 (mint) → every deposit `InvalidTokenAccount`.
2. Hand-built SPL `transfer` missing the 4th account (the token program) → CPI "An account required by the instruction is missing / Unknown program Tokenkeg…". Added `token_program` context account to Deposit/Withdraw/ClaimDividend/TriggerDividend.
3. Hand-built `transfer` authority `AccountMeta::new(*authority, false)` → for a CPI, SPL token program needs `is_signer=true` on the authority (else `MissingRequiredSignature`). Fixed to `true`.

## Real-AAPLx finding (2026-09-17) — DEPLOYED binary cannot service real AAPLx
- **Verified on mainnet-beta (read-only sims):** real Backed xStock `AAPLx`
  (`XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`, Token-2022 with
  `permanentDelegate` + `confidentialTransferMint` extensions) **rejects plain
  `Transfer` with `Custom 31 = MintRequiredForTransfer`** and **accepts
  `TransferChecked`**. So the live program (plain `Transfer`) cannot accept or
  return real AAPLx. A vault holding it would lock user deposits.
- **Earlier "8/8 PASS with a real T2022 mint" was a FALSE green:** the e2e mints
  a *bare* T2022 mint (no extensions), so plain `Transfer` worked there. It never
  exercised real AAPLx.
- **The on-chain binary is the pre-fix build.** On-chain ELF sha256
  `6876d0e577ca45ab5b95f8b0fcaa1b725a244fc9f4f12c886b1157ac15af5945`
  (305,384 B, git HEAD `5933fc4`). The fixed `.so` was un-deployed.

## The correct fix (in tree, local-verified, NOT yet on mainnet)
1. `token_ix.rs` `transfer_checked`: SPL `TransferChecked` is instruction tag
   **12** (NOT 18 — 18 is `InitializeAccount3`), and the account order is
   **`from, mint, to, authority`** (NOT `from, to, mint, …`). The wrong order
   made the token program compare `to.mint` vs `mint` → `Custom 3 = MintMismatch`.
   No 5th "token program" account is passed in the instruction (it's the
   `program_id`); `invoke_signed` matches context accounts **by pubkey**, so the
   token program is already present in the call-site slices.
2. `lib.rs` (already in tree): read `decimals` from the mint, require
   `dividend_mint == vault.dividend_mint`, and use `transfer_checked` on every
   token leg (deposit / withdraw / trigger / claim).
- **Local e2e (new binary, same program ID on a local validator): 8/8 PASS**,
  both invariants hold. Built via `anchor build`; the one
  `Stack offset of 4608 exceeded max offset of 4096` line is a **non-fatal**
  post-link warning that is ALSO in the live on-chain binary (exit 0; it's dead
  solana-program `AbiEnumVisitor` codegen, never executed).

## To put the fix on mainnet (NOT done — awaiting funding decision)
- Cost: ProgramData must be `extend`ed by the new-build size delta, then `Upgrade`
  from a buffer. Peak wallet need ≈ 1.20 SOL top-up, net ≈ 0.027 SOL + fees.
- Or **close** to reclaim the ProgramData rent (~1.5522 SOL) + wallet — the vault
  is empty (totalShares=0), so nothing is owed.
- Do NOT ship the "deposit real AAPLx" claim until the fixed binary is upgraded
  on mainnet.

## Mainnet gotchas hit (for reference)
- `@solana/spl-token@0.4.15` `getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve, tokenProgram)`: 3rd arg is `allowOwnerOffCurve` (bool), 4th is the token program. For a PDA (off-curve) owner you MUST pass `allowOwnerOffCurve=true`. The app was passing the token program as the 3rd arg → 4 tsc errors + runtime `TokenOwnerOffCurveError`.
- The 0.4.15 `createAssociatedTokenAccountIdempotentInstructionWithDerivation` builder calls `getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve)` WITHOUT the tokenProgram → it derives the ATA with the **v3** token program seeds even for a T2022 mint → on-chain ATA program rejects "Associated address does not match seed derivation". Workaround: hand-build the `CreateIdempotent` (data=[1]) ix with the correctly-derived address + the right token program (done in `setup_mainnet_vault.js` and `test_program.js`).
- anchor 0.29 exports `AnchorProvider` (not `Provider`).
- Deployer keypair is `~/.config/solana/id.json`, NOT `target/deploy/streamdividend-keypair.json` (that's the program ID keypair).

## Files
- Program source: `/root/streamdividend/programs/streamdividend/src/` (lib.rs, token_ix.rs)
- IDL: `/root/streamdividend/target/idl/streamdividend.json`
- e2e: `/root/streamdividend/test_program.js`
- Mainnet setup: `/root/streamdividend/setup_mainnet_vault.js`
- Web app: `/root/streamdividend-app` (needs mainnet constants + program ID wired in; was using local/testnet)
