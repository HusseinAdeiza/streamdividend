#!/usr/bin/env bash
# Build the StreamDividend program with Anchor, then run the test suite.
set -euo pipefail
export PATH="/root/.cargo/bin:/root/.local/share/solana/install/active_release/bin:$PATH"
cd /root/streamdividend
anchor build
anchor test --skip-local-validator