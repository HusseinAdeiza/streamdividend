# StreamDividend — Apple's real dividends, streamed to you in USDC

Live demo: **https://husseinadeiza.github.io/streamdividend-app/**
Pitch video: **https://husseinadeiza.github.io/streamdividend-app/videos/StreamDividend_Pitch.mp4**
Technical know-how video: **https://husseinadeiza.github.io/streamdividend-app/videos/StreamDividend_TechKnowHow.mp4**
Player page (both): **https://husseinadeiza.github.io/streamdividend-app/videos/**
Program (Solana mainnet): `LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA`

---

## The problem
Hold tokenized Apple stock (AAPLx — fully backed by real Apple shares) and the
real dividend income **never reaches you**. You wait on an operator, trust a
middleman, or it simply gets stuck. The tokenized market is real; the dividend
income gets lost.

## The solution
StreamDividend is a **non-custodial vault** that streams every real dividend to
holders in USDC the moment it lands on-chain.

- **Deposit** AAPLx → minted 1:1 into vault shares.
- **Dividend accrues** → the vault applies Apple's real payout pro-rata across
  every share; your *dividends per share* rises in that same second.
- **Claim or compound** → take your accrued USDC any time, or leave it in.
- **Withdraw** → paid out first, then your AAPLx back, share-for-share.

Nothing is custodial. Your position is a program-derived account only you
control.

## It's real, not a mock-up
- **Live on Solana mainnet** — the demo video is a connected-wallet click-through:
  wallet connected → deposit → signed → confirmed on-chain.
- The deposit you see in the video is a real transaction: `5g9QVJS8…`, finalized,
  wallet `4KTQ…` 0.00287561 → 0.00137561 AAPLx, vault `2vsxDXua…` 0.009 → 0.0105.
- The live ledger reads straight from the deployed program (0.0105 AAPLx in the
  vault, $0.54/share, USDC already distributed).

## Why this is more than a hackathon demo: we audited it
Before demo day we ran the protocol through a genuine **adversarial security
review** — and it found real bugs:

- **HIGH — dividend-pool drain:** `withdraw` didn't pin the xStock mint. An
  attacker could swap the mint for USDC and drain the entire vault's USDC
  dividend pool through the "return xStock" leg, while corrupting the xStock
  accounting.
- **HIGH — deposit diversion:** `deposit` didn't pin the vault's token account.
  A malicious app could route a user's deposit to an attacker's account while
  inflating the vault's bookkeeping.
- **LOW — dust trigger:** a dividend trigger whose per-share accumulator rounds
  to zero could strand USDC in the pool with no rescue path.

**All three were fixed before shipping, re-verified (8/8 e2e, every exploit
blocked), and the fixed binary is live on mainnet** — byte-identical and
verified on-chain. Finding and shipping a fix for your own buffer overflow style
bug, before someone else does, is exactly the discipline we'd bring to a
production launch.

## Deliverables
- Program source: `github.com/HusseinAdeiza/streamdividend` (Anchor/Solana)
- Web app: `github.com/HusseinAdeiza/streamdividend-app`
- Security audit + fix record in the repo (`AUDIT.md`)
- On-chain proof: live vault + 6 finalized mainnet transactions

*The dividend race isn't per-quarter anymore. It's per-block.*