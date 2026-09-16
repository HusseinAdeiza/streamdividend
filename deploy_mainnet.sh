#!/bin/bash
# StreamDividend — Mainnet deploy (run once the wallet is funded).
# Usage: ./deploy_mainnet.sh
# Requires: solana CLI configured with a funded mainnet wallet, anchor CLI (or target/deploy/streamdividend.so already built).
set -euo pipefail
cd "$(dirname "$0")"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "==> Current wallet & balance"
solana address
solana balance

echo "==> Building release .so"
cargo build-sbf

SO=target/deploy/streamdividend.so
ls -la "$SO"

echo "==> Uploading to mainnet-beta (this can take 10-30 min)"
solana program deploy "$SO" --url mainnet-beta

echo "==> Deploy complete. Capture the printed program address."
echo "    It must match declare_id in programs/streamdividend/src/lib.rs:"
grep -n "declare_id" programs/streamdividend/src/lib.rs
