#!/usr/bin/env python3
"""Generate the StreamDividend IDL matching the Rust account structs EXACTLY.

Account names/order must mirror the #[derive(Accounts)] fields (camelCase).
PDA seeds are included so the Anchor client auto-resolves PDAs; the client
only passes non-PDA accounts (token accounts, mints, programs).
"""
import hashlib, json, os

def disc(prefix, name):
    return list(hashlib.sha256(f"{prefix}:{name}".encode()).digest()[:8])

PROG = "LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA"
U64 = "u64"
U128 = "u128"
U8 = "u8"

def a(name, mut=False, signer=False, pda=None):
    d = {"name": name, "isMut": mut, "isSigner": signer}
    if pda is not None:
        d["pda"] = pda
    return d

# PDAs are computed client-side (src/lib/program.ts) and passed explicitly,
# so the IDL carries no `pda` fields. This is the most reliable path: the
# Anchor client requires an explicit PublicKey for every non-PDA account.
vault_pda = None
vault_xstock_pda = None
vault_dividend_pda = None
user_state_pda = None

instructions = [
    {
        "name": "initialize",
        "discriminator": disc("global", "initialize"),
        "accounts": [
            a("authority", True, True),
            a("vault", True, vault_pda),
            a("xstockMint"),
            a("dividendMint"),
            a("systemProgram"),
        ],
        "args": [],
    },
    {
        "name": "createTokenAccounts",
        "discriminator": disc("global", "createTokenAccounts"),
        "accounts": [
            a("authority", True, True),
            a("vault", True),
            a("vaultXstock", True, vault_xstock_pda),
            a("vaultDividend", True, vault_dividend_pda),
            a("xstockMint"),
            a("dividendMint"),
            a("tokenProgram"),
            a("systemProgram"),
        ],
        "args": [],
    },
    {
        "name": "deposit",
        "discriminator": disc("global", "deposit"),
        "accounts": [
            a("user", True, True),
            a("vault", True),
            a("userState", True, user_state_pda),
            a("userXstock", True),
            a("vaultXstock", True, vault_xstock_pda),
            a("xstockMint"),
            a("tokenProgram"),
            a("systemProgram"),
        ],
        "args": [{"name": "amount", "type": U64}],
    },
    {
        "name": "withdraw",
        "discriminator": disc("global", "withdraw"),
        "accounts": [
            a("user", True, True),
            a("vault", True),
            a("userState", True, user_state_pda),
            a("userXstock", True),
            a("vaultXstock", True, vault_xstock_pda),
            a("userDividend", True),
            a("vaultDividend", True, vault_dividend_pda),
            a("tokenProgram"),
        ],
        "args": [{"name": "shares", "type": U64}],
    },
    {
        "name": "triggerDividend",
        "discriminator": disc("global", "triggerDividend"),
        "accounts": [
            a("authority", True, True),
            a("vault", True),
            a("adminDividend", True),
            a("vaultDividend", True, vault_dividend_pda),
            a("tokenProgram"),
        ],
        "args": [{"name": "amount", "type": U64}],
    },
    {
        "name": "claimDividend",
        "discriminator": disc("global", "claimDividend"),
        "accounts": [
            a("user", True, True),
            a("vault", True),
            a("userState", True, user_state_pda),
            a("userDividend", True),
            a("vaultDividend", True, vault_dividend_pda),
            a("tokenProgram"),
        ],
        "args": [],
    },
    {
        "name": "setRoute",
        "discriminator": disc("global", "setRoute"),
        "accounts": [
            a("user", True, True),
            a("vault"),
            a("userState", True, user_state_pda),
        ],
        "args": [{"name": "route", "type": {"defined": "RoutePreference"}}],
    },
    {
        "name": "earned",
        "discriminator": disc("global", "earned"),
        "accounts": [
            a("user", True, True),
            a("vault"),
            a("userState", True, user_state_pda),
        ],
        "args": [],
        "returns": "u64",
    },
]

types = [
    {
        "name": "UserState",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "user", "type": "publicKey"},
                {"name": "vault", "type": "publicKey"},
                {"name": "shares", "type": "u64"},
                {"name": "lastDividendsPerShare", "type": "u128"},
                {"name": "route", "type": {"defined": "RoutePreference"}},
                {"name": "bump", "type": "u8"},
            ],
        },
    },
    {
        "name": "Vault",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "authority", "type": "publicKey"},
                {"name": "xstockMint", "type": "publicKey"},
                {"name": "dividendMint", "type": "publicKey"},
                {"name": "totalShares", "type": "u64"},
                {"name": "totalXstock", "type": "u64"},
                {"name": "dividendPool", "type": "u64"},
                {"name": "totalDividendsDistributed", "type": "u64"},
                {"name": "dividendsPerShare", "type": "u128"},
                {"name": "lastDividendTs", "type": "i64"},
                {"name": "route", "type": {"defined": "RoutePreference"}},
                {"name": "bump", "type": "u8"},
            ],
        },
    },
    {
        "name": "RoutePreference",
        "type": {
            "kind": "enum",
            "variants": [
                {"name": "Stream", "fields": None},
                {"name": "AutoCompound", "fields": None},
            ],
        },
    },
]

events = [
    {"name": "DepositEvent", "discriminator": disc("event", "DepositEvent"),
     "fields": [{"name": "user", "type": "publicKey"},
                {"name": "amount", "type": "u64"},
                {"name": "shares", "type": "u64"}]},
    {"name": "WithdrawEvent", "discriminator": disc("event", "WithdrawEvent"),
     "fields": [{"name": "user", "type": "publicKey"},
                {"name": "shares", "type": "u64"},
                {"name": "xstockOut", "type": "u64"}]},
    {"name": "DividendTriggered", "discriminator": disc("event", "DividendTriggered"),
     "fields": [{"name": "amount", "type": "u64"},
                {"name": "perShare", "type": "u128"}]},
    {"name": "DividendClaimed", "discriminator": disc("event", "DividendClaimed"),
     "fields": [{"name": "user", "type": "publicKey"},
                {"name": "amount", "type": "u64"}]},
    {"name": "RouteSet", "discriminator": disc("event", "RouteSet"),
     "fields": [{"name": "user", "type": "publicKey"},
                {"name": "route", "type": "u8"}]},
]

errors = [
    {"code": 6000, "name": "ZeroAmount", "msg": "Amount must be greater than zero"},
    {"code": 6001, "name": "InsufficientShares", "msg": "Insufficient shares to withdraw"},
    {"code": 6002, "name": "NoShares", "msg": "No shares outstanding"},
    {"code": 6003, "name": "NothingToClaim", "msg": "Nothing to claim"},
    {"code": 6004, "name": "Unauthorized", "msg": "Caller is not the vault authority"},
    {"code": 6005, "name": "ZeroShares", "msg": "Deposit resulted in zero shares"},
    {"code": 6006, "name": "Overflow", "msg": "Arithmetic overflow"},
]

idl = {
    "version": "0.0.1",
    "name": "streamdividend",
    "address": PROG,
    "metadata": {"address": PROG},
    "instructions": instructions,
    "accounts": [
        {"name": "UserState", "type": {"kind": "struct", "fields": [
            {"name": "user", "type": "publicKey"},
            {"name": "vault", "type": "publicKey"},
            {"name": "shares", "type": "u64"},
            {"name": "lastDividendsPerShare", "type": "u128"},
            {"name": "route", "type": {"defined": "RoutePreference"}},
            {"name": "bump", "type": "u8"},
        ]}},
        {"name": "Vault", "type": {"kind": "struct", "fields": [
            {"name": "authority", "type": "publicKey"},
            {"name": "xstockMint", "type": "publicKey"},
            {"name": "dividendMint", "type": "publicKey"},
            {"name": "totalShares", "type": "u64"},
            {"name": "totalXstock", "type": "u64"},
            {"name": "dividendPool", "type": "u64"},
            {"name": "totalDividendsDistributed", "type": "u64"},
            {"name": "dividendsPerShare", "type": "u128"},
            {"name": "lastDividendTs", "type": "i64"},
            {"name": "route", "type": {"defined": "RoutePreference"}},
            {"name": "bump", "type": "u8"},
        ]}},
    ],
    "types": types,
    "events": events,
    "errors": errors,
    "metadata": {"address": PROG},
}

def main():
    out = json.dumps(idl, indent=2)
    paths = [
        "/root/streamdividend/target/idl/streamdividend.json",
        "/root/streamdividend-app/src/lib/idl.json",
    ]
    for path in paths:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(out)
    for p in paths:
        print("wrote", p)
    for ins in instructions:
        print(f"  {ins['name']:<20} {ins['discriminator']}")

if __name__ == "__main__":
    main()