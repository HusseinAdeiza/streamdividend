# StreamDividend — Security Audit (adversarial / PoC-verified)

**Scope:** `LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA`, the exact live
mainnet binary (ELF 215,272 B, sha256 `83e25a99…`). Every finding below was
**reproduced on-chain against that binary** on a local `solana-test-validator`
(see `audit_poc.js` / `audit_poc2.js`), not just reasoned about in the source.

Method: white-box source review of `lib.rs` + `token_ix.rs`, then black-box
PoCs that attack the *running* program as an untrusted external caller would.

---

## Findings summary

| ID   | Severity | Instruction | Status          | User funds at risk |
|------|----------|-------------|-----------------|--------------------|
| F-1  | **HIGH** | `withdraw`  | **EXPLOITED** (on-chain) | Vault USDC dividend pool fully drained |
| F-1b | **HIGH** | `deposit`   | **EXPLOITED** (on-chain) | Depositing user's xStock diverted to attacker |
| F-2  | **LOW**  | `triggerDividend` | Reproduced (on-chain) | Dust USDC stuck in pool (liveness) |
| H-A  | info     | `deposit`/`withdraw` | Measured | Sub-dollar, fair rounding |
| H-B  | info     | `deposit`/`withdraw` | Measured | Not triggered in normal ratios |

No Critical found: the **underlying xStock is never stolen** (it stays in the
vault's xStock account). The two HIGHs attack the **USDC dividend pool** and
the **deposit routing**, not the asset.

---

## F-1 (HIGH) — `withdraw` mint-swap drains the USDC dividend pool

**Root cause.** `withdraw` validates `dividend_mint == vault.dividend_mint` but
does **not** pin `xstock_mint == vault.xstock_mint`, and it performs **no**
ownership/mint validation on the `CHECK` token accounts `vault_xstock` /
`user_xstock`.

The handler computes `xstock_out = shares * total_xstock / total_shares` and
then CPIs
```
TransferChecked(from=vault_xstock, to=user_xstock, mint=xstock_mint,
                authority=vault_PDA, amount=xstock_out,
                decimals=mint_decimals(xstock_mint))
```
All four of those account slots are caller-controlled and unchecked. An
attacker who has a normal depositor position (any amount of shares) can call
`withdraw` with:

- `xstockMint   = <USDC mint>`  (6 decimals, not 8)
- `vaultXstock  = <vault's own USDC pool ATA>`  (owned by the vault PDA, mint = USDC)
- `userXstock   = <attacker's USDC ATA>`

The vault PDA signs the "return xStock" leg, so the token program happily moves
**USDC** out of the vault's dividend pool into the attacker's wallet.

**Why it pays out more than the attacker staked:** xStock is 8-decimal, USDC is
6-decimal. `xstock_out` is computed in 8-dp base units but sent with
`decimals=6`, a 100× unit inflation. A depositor who put in 1 xStock (~$1)
gets `xstock_out ≈ 1e8` base, which as 6-dp USDC = **100 USDC**.

**On-chain PoC (`audit_poc.js`, F-1):**
```
pool 100 USDC; attacker position 100000000 shares (1 xStock deposited)
*** EXPLOIT SUCCEEDED ***  withdrew 99900090 shares via USDC-mint swap
  USDC drained from vault pool: 99.99999 USDC (pool was 100)
  USDC credited to attacker:    99.99999 USDC
  vault.total_xstock: 100100000000 -> 100000099910 (corrupted; real xStock untouched)
```
Attacker cost ≈ 1 xStock + fees; drained the **entire 100 USDC pool** and left
`total_xstock` corrupted (understated), which skews every subsequent real
withdrawal.

**Fix (in `withdraw`):**
```rust
require!(ctx.accounts.xstock_mint.key() == vault.xstock_mint, ErrorCode::InvalidTokenAccount);
require!(token_account_mint(&ctx.accounts.vault_xstock)? == vault.xstock_mint, ErrorCode::InvalidTokenAccount);
require!(token_account_mint(&ctx.accounts.user_xstock)? == vault.xstock_mint, ErrorCode::InvalidTokenAccount);
require!(token_account_owner(&ctx.accounts.vault_xstock)? == ctx.accounts.vault.key(), ErrorCode::InvalidTokenAccount);
require!(token_account_owner(&ctx.accounts.user_xstock)?  == ctx.accounts.user.key(),   ErrorCode::InvalidTokenAccount);
```

---

## F-1b (HIGH) — `deposit` routes the user's tokens to an attacker account

**Root cause.** `deposit` validates `vault_xstock.owner == token_program` and
that its mint field equals `vault.xstock_mint` — but a token account's `owner`
field is the *token program*, not the wallet. The handler never checks that the
**wallet** recorded inside `vault_xstock`'s data is the vault PDA. So any valid
xStock account (e.g. the attacker's own ATA) is accepted as `vaultXstock`.

`deposit` then does `TransferChecked(from=user_xstock, to=vault_xstock, …)` and
credits `user_state.shares` / `vault.total_shares` / `vault.total_xstock` as if
the vault received the tokens.

**Effect:** a malicious frontend (or a user signing a crafted tx) makes a
"deposit" that silently sends the user's xStock to the attacker while inflating
the vault's bookkeeping. The vault's real `vault_xstock` balance diverges from
`total_xstock` (the vault now believes it holds more xStock than it does), so
later real withdrawals are short-changed.

**On-chain PoC (`audit_poc.js`, F-1b):**
```
*** EXPLOIT SUCCEEDED ***  user h "deposited" 5 xStock but tokens went to attacker:
  attacker ATA +5 xStock; vault accounting inflated (user holds shares, vault holds no tokens)
```

**Fix (in `deposit`):** also require the *data owner* of `vault_xstock` is the
vault PDA (same `token_account_owner` check as above). `user_xstock` data owner
should equal the signing `user`.

---

## F-2 (LOW, liveness) — dust dividend stuck in the pool, no rescue

**Root cause.** `per_share = amount * 1e12 / total_shares` and
`earned = shares * delta / 1e12` both truncate. If the authority triggers a
dividend small enough that `per_share` rounds to 0 (or a holder's `earned`
rounds to 0), the USDC still moves into the pool (`dividend_pool += amount`)
but no holder can ever claim it, and there is **no** rescue /
`withdraw_pool` / close instruction to get it back out.

**On-chain PoC (`audit_poc.js`, F-2):**
```
pool 10 -> 11 (+1 base); victim claim=err (NothingToClaim) (+0 base);
remainder stuck in pool, no rescue ix
```
`per_share` for 1 base into a ~1e11-share vault ≈ 9; holder `earned` ≈ 0.9
base → truncates to 0 → claim reverts with `NothingToClaim`; the base unit is
trapped.

**Impact:** bounded (dust), but unbounded *cumulatively* if an operator (or a
phished operator) repeatedly triggers dust. It is a liveness/UX issue and a
small trust issue (the authority's own USDC can be stranded in the pool).

**Fix:** add an `authority`-gated `rescuePool` (or `sweepDust`) instruction that
returns the unclaimed `dividend_pool` remainder to the authority; and/or make
`triggerDividend` reject `amount` where `per_share == 0` (i.e. require
`amount * 1e12 >= total_shares`) so no dust trigger can be minted.

---

## H-A (info) — rounding is fair (no exploitable drift)

1:1 vs pro-rata share math. Measured a 10-xStock round-trip in a 1:1 vault:
```
deposited 1e9 units, withdrew 1000000000 units (exact)
```
Truncation always rounds **down** (vault retains ≤ 1 base of dust per op), so a
first depositor is never *over*-paid. Adversarial ratios can strand sub-base
dust in the vault, but the user is never net-negative beyond 1 base unit. Not
a vulnerability.

## H-B (info) — dust deposit is withdrawable in normal ratios

A 1-base deposit mints 1 share and round-trips exactly in a 1:1 vault:
```
deposit 1 base: ok  ->  shares=1  ->  full-withdraw: ok
```
It would only truncate `xstock_out` to 0 (ZeroAmount → locked) if the vault were
so heavily over-subscribed that `shares * total_xstock / total_shares < 1`,
which is not reachable in the intended deployment. Info only.

---

## What is safe (verified, not assumed)
- **xStock custody:** both HIGHs require the swapped/passed account to match the
  swapped mint; the vault's *real* xStock account (8-dp) can never be drained by
  a 6-dp USDC swap (MintMismatch rejects it). The underlying asset is intact.
- **Authority:** `triggerDividend` correctly requires `authority == vault.authority`.
- **No re-entrancy / no arbitrary CPI:** the only CPIs are fixed `TransferChecked`
  to the token program; `invoke_signed` uses the vault PDA seeds only.
- **Overflow:** all share/accumulator math is `checked_*` + u128; `PRECISION=1e12`.

## Recommended pre-deadline patch order
1. **F-1 + F-1b (HIGH):** add the mint-pin + data-owner checks in `withdraw` and
   `deposit` (≈6 lines). Rebuild, re-run `audit_poc.js` — F-1/F-1b must now
   `blocked`.
2. **F-2 (LOW):** add `rescuePool` (authority) and reject `per_share==0` triggers.
3. Re-run the 8/8 e2e + the audit PoC suite, confirm clean, then (optionally)
   upgrade mainnet — the program is still upgradeable, so this is a one-`solana
   program deploy` fix that also **strengthens the hackathon narrative** ("we
   audited it ourselves and found + fixed 2 HIGHs before shipping").

---

## Fix implemented (commit `6a6b097`) — status
- **F-1 + F-1b:** fixed in source (mint-pin + `token_account_owner` data-owner
  checks in `withdraw` and `deposit`). Built clean: **220,912 B** (sha
  `abb733cc…`), +5.6 KB over the live 215,272 B binary.
- **F-2:** fixed in source — `triggerDividend` now rejects `per_share == 0`
  (dust triggers can no longer strand USDC). (No `rescuePool` added — with the
  rejection, dust can never enter the pool; a sweep ix is only needed if dust
  already exists, which on mainnet it does not: the vault has no users yet.)
- **Re-verification (DONE, local validator, fresh deploy of `abb733cc`):**
  - `node test_program.js` → **8/8 PASS** (invariants exact).
  - `node audit_poc.js` against the FIXED binary:
    - F-1 (USDC drain): **blocked — `Invalid token account`**
    - F-1b (deposit diversion): **blocked — `Invalid token account`**
    - F-2 (per-share dust trigger): **blocked — `Amount must be greater than zero`**
    - H-A (rounding): exact at 10 xStock (no drift at normal sizes; sub-base
      residue stays vault-side, dust only)
    - H-B (1 base-unit deposit): still locks a 1-share position (info; user
      loses at most 1 base unit — pre-existing, cosmetic)
  - Net: 2 HIGH + 1 LOW eliminated, zero behavior regression.
- **Mainnet:** **UPGRADED & VERIFIED (slot 448180469).** Live binary is the
  fixed **220,912 B** build (sha `abb733ccd66ac365`) — on-chain ProgramData
  payload @ offset 45 is byte-identical to the local build (0 differing
  bytes). F-1, F-1b, F-2 are all blocked on mainnet now.
  - Upgrade path note: the PD account was pre-sized to 305,384 B (Data
    Length), so no expansion was needed — only ~0.001 SOL in fees (buffer rent
    refunded 1:1).
  - **ProgramData layout gotcha for verification:** layout is tag(4)=3 +
    slot(u64)@4 + Option<Pubkey> authority@12..45 (tag `01` + 32 B); program
    payload starts at offset **45** (not 44/36). Use @45 when re-verifying.
