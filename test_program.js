// Self-contained E2E: creates its own mints + ATAs, then runs the full flow.
// Matches the lean program (v3 + Token-2022 support via owner dispatch):
//   initialize → (client creates vault ATAs) → deposit → trigger → claim → withdraw
const {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction,
} = require("@solana/web3.js");
const { Program, AnchorProvider, BN } = require("@coral-xyz/anchor");
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createMint, mintTo,
  createAssociatedTokenAccountIdempotent,
} = require("@solana/spl-token");
const { sendAndConfirmTransaction } = require("@solana/web3.js");
const fs = require("fs");

const idl = require("./target/idl/streamdividend.json");
const PROGRAM = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
const TOKEN_PROG = new PublicKey(TOKEN_PROGRAM_ID);
const T2022_PROG = new PublicKey(TOKEN_2022_PROGRAM_ID);
const SYS_PROG = SystemProgram.programId;

const PAYER = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8")))
);
const conn = new Connection("http://localhost:8899", "confirmed");
const wallet = {
  publicKey: PAYER.publicKey,
  signTransaction: async (tx) => { tx.partialSign(PAYER); return tx; },
  signAllTransactions: async (txs) => txs.map((t) => { t.partialSign(PAYER); return t; }),
};
const provider = new AnchorProvider(conn, wallet, {});
const program = new Program(idl, PROGRAM, provider);

function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), PROGRAM);
}

async function setupTokens() {
  // xStock = REAL Token-2022 mint (6 dec to keep the invariant math); USDC = v3.
  // This matches mainnet reality: AAPLx is Token-2022, USDC is v3, and the
  // program dispatches the token program from the mint owner.
  const xstockMint = await createMint(
    conn, PAYER, PAYER.publicKey, null, 6, undefined, undefined, TOKEN_2022_PROGRAM_ID
  );
  const usdcMint = await createMint(conn, PAYER, PAYER.publicKey, null, 6);
  await createAssociatedTokenAccountIdempotent(conn, PAYER, xstockMint, PAYER.publicKey, undefined, TOKEN_2022_PROGRAM_ID);
  await createAssociatedTokenAccountIdempotent(conn, PAYER, usdcMint, PAYER.publicKey);
  const xAta = getAssociatedTokenAddressSync(xstockMint, PAYER.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const uAta = getAssociatedTokenAddressSync(usdcMint, PAYER.publicKey);
  const ONE_M = 1_000_000 * 1_000_000;
  await mintTo(conn, PAYER, xstockMint, xAta, PAYER.publicKey, ONE_M, undefined, undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(conn, PAYER, usdcMint, uAta, PAYER.publicKey, ONE_M);
  return { xstockMint, usdcMint };
}

async function main() {
  const auth = PAYER.publicKey;
  console.log("Setting up mints…");
  const { xstockMint, usdcMint } = await setupTokens();
  console.log("xStock mint:", xstockMint.toBase58());
  console.log("USDC mint:  ", usdcMint.toBase58());

  const [vault] = pda(["vault", auth.toBuffer()]);
  const vaultXstock = getAssociatedTokenAddressSync(xstockMint, vault, true, TOKEN_2022_PROGRAM_ID);
  const vaultDividend = getAssociatedTokenAddressSync(usdcMint, vault, true);
  const [userState] = pda(["user", vault.toBuffer(), auth.toBuffer()]);
  const userXstock = getAssociatedTokenAddressSync(xstockMint, auth, false, TOKEN_2022_PROGRAM_ID);
  const userDividend = getAssociatedTokenAddressSync(usdcMint, auth);

  // Hand-built CreateIdempotent (data=[1]) with the canonical ATA + the
  // mint's token program. (The 0.4.15 WithDerivation helper drops the token
  // program from the seed derivation, so it produces the WRONG address for a
  // Token-2022 mint — on-chain ATA program rejects it.)
  const A_TOKEN = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const ataIx = (ata, owner, mint, tokenProg) => new TransactionInstruction({
    keys: [
      { pubkey: PAYER.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYS_PROG, isSigner: false, isWritable: false },
      { pubkey: tokenProg, isSigner: false, isWritable: false },
    ],
    programId: A_TOKEN,
    data: Buffer.from([1]),
  });

  const results = [];
  const step = (name, fn) =>
    fn().then(
      (v) => { results.push([name, "PASS", v]); console.log("✓ " + name + (v ? " → " + v : "")); },
      (e) => { results.push([name, "FAIL", e.message]); console.log("✗ " + name + " → " + e.message); }
    );

  console.log("\n=== 1. initialize ===");
  await step("initialize", () =>
    program.methods.initialize().accounts({
      authority: auth,
      vault, xstockMint, dividendMint: usdcMint, systemProgram: SYS_PROG,
    }).rpc()
  );

  console.log("\n=== 2. create vault ATAs (client-side, idempotent) ===");
  await step("vault xStock ATA", () =>
    (async () => {
      const ix = ataIx(vaultXstock, vault, xstockMint, TOKEN_2022_PROGRAM_ID);
      const tx = new Transaction().add(ix);
      const r = await sendAndConfirmTransaction(conn, tx, [PAYER]);
      return r;
    })()
  );
  await step("vault USDC ATA", () =>
    (async () => {
      const ix = ataIx(vaultDividend, vault, usdcMint, TOKEN_PROG);
      const tx = new Transaction().add(ix);
      const r = await sendAndConfirmTransaction(conn, tx, [PAYER]);
      return r;
    })()
  );

  console.log("\n=== 3. deposit 100 xStock ===");
  await step("deposit 100 xStock", () =>
    program.methods.deposit(new BN(100 * 1e6)).accounts({
      user: auth, vault, userState,
      userXstock, vaultXstock, xstockMint, systemProgram: SYS_PROG,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).rpc()
  );

  console.log("\n=== 4. trigger_dividend 50 USDC ===");
  await step("triggerDividend 50 USDC", () =>
    program.methods.triggerDividend(new BN(50 * 1e6)).accounts({
      authority: auth, vault,
      adminDividend: userDividend, vaultDividend, dividendMint: usdcMint,
      systemProgram: SYS_PROG, tokenProgram: TOKEN_PROG,
    }).rpc()
  );

  console.log("\n=== 5. claim_dividend ===");
  await step("claimDividend", () =>
    program.methods.claimDividend().accounts({
      user: auth, vault, userState,
      userDividend, vaultDividend, dividendMint: usdcMint,
      tokenProgram: TOKEN_PROG,
    }).rpc()
  );

  console.log("\n=== 6. withdraw 50 shares (half) ===");
  await step("withdraw 50 shares (half)", () =>
    program.methods.withdraw(new BN(50 * 1e6)).accounts({
      user: auth, vault, userState,
      userXstock, vaultXstock, userDividend, vaultDividend,
      xstockMint, dividendMint: usdcMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      usdcTokenProgram: TOKEN_PROG,
    }).rpc()
  );

  console.log("\n=== 7. second deposit (pro-rata ratio check) ===");
  await step("deposit 20 xStock after half-withdraw", () =>
    program.methods.deposit(new BN(20 * 1e6)).accounts({
      user: auth, vault, userState,
      userXstock, vaultXstock, xstockMint, systemProgram: SYS_PROG,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).rpc()
  );

  console.log("\n=== Final state ===");
  const v = await program.account.vault.fetch(vault);
  const u = await program.account.userState.fetch(userState);
  const balDiv = await conn.getTokenAccountBalance(userDividend);
  const balX = await conn.getTokenAccountBalance(userXstock);
  console.log("vault:  totalShares=" + v.totalShares.toString(),
    "totalXstock=" + v.totalXstock.toString(),
    "dividendsPerShare=" + v.dividendsPerShare.toString(),
    "pool=" + v.dividendPool.toString());
  console.log("user:   shares=" + u.shares.toString(),
    "lastDps=" + u.lastDividendsPerShare.toString());
  console.log("user USDC balance:   " + balDiv.value.uiAmountString);
  console.log("user xStock balance: " + balX.value.uiAmountString);

  // Flow: 1,000,000 xStock minted.
  //   deposit 100 → shares 100 (1:1 first deposit)
  //   trigger 50 USDC → dps += 50/100 share → user claims 50 USDC
  //   withdraw 50 shares → 50 xStock back; remaining xStock in vault = 50
  //   deposit 20 → shares += 20 * 50/50 = 20  (ratio preserved)
  // USDC: 1,000,000 - 50 (trigger) + 50 (claim) = 1,000,000
  // xStock: 1,000,000 - 100 (deposit) + 50 (withdraw) - 20 (re-deposit) = 999,930
  const got = Number(balDiv.value.uiAmountString);
  const xsBack = Number(balX.value.uiAmountString);
  const ok1 = Math.abs(got - 1_000_000) < 1;
  const ok2 = Math.abs(xsBack - 999_930) < 1;
  console.log("\nInvariant 1 (user USDC = 1,000,000): " + (ok1 ? "PASS" : "FAIL (got " + got + ")"));
  console.log("Invariant 2 (user xStock = 999,930):  " + (ok2 ? "PASS" : "FAIL (got " + xsBack + ")"));

  const passed = results.filter((r) => r[1] === "PASS").length;
  console.log("\n=== RESULT: " + passed + "/" + results.length + " steps passed ===");
  if (passed !== results.length || !ok1 || !ok2) process.exitCode = 1;
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
