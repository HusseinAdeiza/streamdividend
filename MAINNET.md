# StreamDividend — MAINNET LIVE (2026-09-16, upgraded 2026-09-17)

## Program
- **Program ID:** `LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA`
- **UPGRADED 2026-09-18 (SECURITY v3):** ELF is now **220,912 B** (fixed binary, sha256 `abb733ccd66ac365`), deployed slot **448180469** — F-1/F-1b (USDC pool drain + deposit diversion) and F-2 (dust trigger) are all blocked. Verified byte-identical on-chain (payload @ offset 45, 0 differing bytes). This supersedes the 09-17 `83e25a99…` (215,272 B) security release.
- **HOW TO VERIFY ON-CHAIN:** ProgramData layout = tag(4)=3 + slot(u64)@4 + Option<Pubkey> auth@12..45; program payload starts at offset **45**. `sha256(payload[45:45+220912])` vs local `.so` must match.
- ProgramData: `3EVmVdXM8WoMZG2jd527Wn4Vhmm222RXLTfnRthszCYw` (1.55222956 SOL rent, **recoverable** via close; allocation kept at 305,429 B, new ELF zero-padded per loader)
- Upgrade authority: `4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi` (still upgradeable)

## Deployer / vault authority wallet
- `4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi`
- Keyfile: `~/.config/solana/id.json` (NOT `target/deploy/streamdividend-keypair.json` — that's the program ID keypair, a different key)
- Balance after deploy: ~1.15 SOL (buffer rent was refunded 1:1; only fees consumed). Sufficient for vault init + fees.

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

## Real-AAPLx finding (2026-09-17) — the pre-upgrade binary could NOT service real AAPLx
- **Verified on mainnet-beta (read-only sims):** real Backed xStock `AAPLx`
  (`XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`, Token-2022 with
  `permanentDelegate` + `confidentialTransferMint` extensions) **rejects plain
  `Transfer` with `Custom 31 = MintRequiredForTransfer`** and **accepts
  `TransferChecked`**. The original live program used plain `Transfer`, so it
  could not accept or return real AAPLx — a vault holding it would lock user deposits.
- **Earlier "8/8 PASS with a real T2022 mint" was a FALSE green:** the e2e mints
  a *bare* T2022 mint (no extensions), so plain `Transfer` worked there. It never
  exercised real AAPLx.
- **RESOLVED 2026-09-17:** the fixed, compressed binary was upgraded onto the
  same Program ID. The old ELF sha256 `6876d0e5…` (305,384 B) is gone; the live
  ELF is now `83e25a99…` (215,272 B), TransferChecked-based.

## The correct fix (NOW ON MAINNET)
1. `token_ix.rs` `transfer_checked`: SPL `TransferChecked` is instruction tag
   **12** (NOT 18 — 18 is `InitializeAccount3`), and the account order is
   **`from, mint, to, authority`** (NOT `from, to, mint, …`). The wrong order
   made the token program compare `to.mint` vs `mint` → `Custom 3 = MintMismatch`.
2. `lib.rs`: read `decimals` from the mint, require
   `dividend_mint == vault.dividend_mint`, and use `transfer_checked` on every
   token leg (deposit / withdraw / trigger / claim).
- **Verification (2026-09-17):**
  - Local e2e (same program ID on a local validator): **8/8 PASS**, both invariants hold.
  - Mainnet sim against the UPGRADED program: **single-instruction deposit of the
    full real-AAPLx balance (0.01187561) into the live vault → SIM PASS, 33,733 CU**
    (no setup txs — the vault's 179B T2022 AAPLx ATA already exists on-chain).
- **Real-AAPLx note for the demo:** AAPLx accounts need **179 bytes** (base 165 +
  14B confidentialTransferAccount extension). The vault's existing AAPLx ATA is
  the 2022-derivation `E4qLqRdxvv1HTAS7gePCq9JMaNhE1BpXh3WUEJjezpsk` (179B, owner = vault PDA).
  For an off-curve PDA owner the SDK's `getAssociatedTokenAddressSync(mint, pda, true,
  TOKEN_2022_PROGRAM_ID)` is the correct derivation; the v3-style one mis-derives.

## Deployment record (2026-09-17)
- Upgrade executed via `solana program deploy … --program-id … --url mainnet-beta`
  (wallet funded the 215,309B buffer at rent-exemption, wrote the ELF in
  1023B `SetBufferData` chunks, then `Upgrade`). Buffer was drained (0 lamports)
  and its rent returned to the wallet by the loader; ProgramData stayed at its
  existing 1.55222956 SOL (allocation unchanged, new ELF zero-padded).
- Net wallet cost: fees only (~0.001 SOL). Wallet ~1.1031 SOL post-upgrade.
- To fully tear down later: `close` the ProgramData to reclaim ~1.5522 SOL
  (vault is empty, totalShares=0, nothing owed). Program would be tombstoned.

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
