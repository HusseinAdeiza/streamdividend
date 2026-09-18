// MAINNET REAL DEMO — all three steps, signed with the authority wallet (4KTQi…).
// 1) Deposit ALL AAPLx (1191443 base) into the live vault
// 2) Trigger dividend sized so it displays as $0.27/share (Apple's real rate)
// 3) Claim the accrued USDC into the wallet's USDC ATA
const fs = require("fs");
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { AnchorProvider, Program, BN } = require("@coral-xyz/anchor");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

const RPC = "https://api.mainnet-beta.solana.com";
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const idl = JSON.parse(fs.readFileSync("/root/streamdividend-app/src/lib/idl.json", "utf8"));
const PROGRAM_ID = "LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA";
const AAPLX_MINT = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const connection = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(connection, {
  publicKey: AUTH.publicKey,
  signTransaction: async (tx) => { tx.feePayer = AUTH.publicKey; tx.sign(AUTH); return tx; },
  signAllTransactions: async (txs) => { txs.forEach(t => { t.feePayer = AUTH.publicKey; t.sign(AUTH); }); return txs; },
}, { preflightCommitment: "confirmed", commitment: "confirmed" });
const program = new Program(idl, PROGRAM_ID, provider);

const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), AUTH.publicKey.toBuffer()], program.programId);
const [userState] = PublicKey.findProgramAddressSync([Buffer.from("user"), vault.toBuffer(), AUTH.publicKey.toBuffer()], program.programId);
const userAaplAta = getAssociatedTokenAddressSync(AAPLX_MINT, AUTH.publicKey, true, TOKEN_2022);
const vaultAaplAta = getAssociatedTokenAddressSync(AAPLX_MINT, vault, true, TOKEN_2022);
const userUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, AUTH.publicKey);
const vaultUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, vault, true, TOKEN_PROG);

function balBase(ata) { return connection.getTokenAccountBalance(ata, "confirmed").then(r => BigInt(r.value.uiAmountString ? r.value.uiAmountString.replace(/\.?0+$/, "") : "0")); }

async function sendTx(tx, label) {
  const bh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.recentBlockhash = bh;
  tx.feePayer = AUTH.publicKey;
  tx.sign(AUTH);
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  console.log(label, "sig:", sig);
  const conf = await connection.confirmTransaction(sig, "confirmed");
  if (conf.value.err) { console.error(label, "TX ERR:", JSON.stringify(conf.value.err)); process.exit(1); }
  console.log(label, "confirmed ✓");
  return sig;
}

(async () => {
  const s = [];

  // ---------- STEP 1: DEPOSIT all AAPLx ----------
  const before = await connection.getTokenAccountBalance(userAaplAta, "confirmed");
  const amt = BigInt(before.value.amount); // exact base units
  console.log(`\n=== STEP 1: deposit ${before.value.uiAmountString} AAPLx (all of it, ${amt} base)`);
  const t1 = await program.methods
    .deposit(new BN(before.value.amount))
    .accounts({
      user: AUTH.publicKey,
      vault, userState,
      userXstock: userAaplAta, vaultXstock: vaultAaplAta, xstockMint: AAPLX_MINT,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022,
    })
    .transaction();
  s.push(["deposit", await sendTx(t1, "deposit")]);

  // ---------- STEP 2: TRIGGER dividend at $0.27/share ----------
  const vi = await connection.getAccountInfo(vault, "confirmed");
  const v = program.coder.accounts.decode("Vault", vi.data);
  const totalShares = Number(v.totalShares.toString());
  const dps = 2_700_000_000n; // 2.7e9 -> displays $0.27/share
  const triggerAmt = Number((dps * BigInt(totalShares)) / 1_000_000_000_000n);
  console.log(`\n=== STEP 2: trigger ${triggerAmt} base USDC (${(triggerAmt / 1e6).toFixed(6)} USDC) = $0.27/share on ${totalShares / 1e8} AAPLx`);
  const t2 = await program.methods
    .triggerDividend(new BN(triggerAmt))
    .accounts({
      vault, authority: AUTH.publicKey,
      adminDividend: userUsdcAta, vaultDividend: vaultUsdcAta,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROG,
    })
    .transaction();
  s.push(["trigger", await sendTx(t2, "trigger")]);

  // ---------- STEP 3: CLAIM ----------
  const vi2 = await connection.getAccountInfo(vault, "confirmed");
  const v2 = program.coder.accounts.decode("Vault", vi2.data);
  const us2 = program.coder.accounts.decode("UserState", (await connection.getAccountInfo(userState, "confirmed")).data);
  const delta = v2.dividendsPerShare.sub(us2.lastDividendsPerShare);
  const earned = Number((BigInt(us2.shares.toString()) * delta) / 1_000_000_000_000n);
  console.log(`\n=== STEP 3: claim ${earned} base USDC (${(earned / 1e6).toFixed(6)} USDC)`);
  const t3 = await program.methods
    .claimDividend()
    .accounts({ vault, userState, user: AUTH.publicKey, userDividend: userUsdcAta, vaultDividend: vaultUsdcAta, tokenProgram: TOKEN_PROG })
    .transaction();
  s.push(["claim", await sendTx(t3, "claim")]);

  // ---------- VERIFY FINAL STATE ----------
  console.log("\n=== FINAL STATE ===");
  const vi3 = await connection.getAccountInfo(vault, "confirmed");
  const v3 = program.coder.accounts.decode("Vault", vi3.data);
  console.log("vault totalShares :", v3.totalShares.toString(), "=", v3.totalShares / 100000000, "AAPLx");
  console.log("vault dividendsPerShare:", v3.dividendsPerShare.toString(), "-> $", (Number(v3.dividendsPerShare) / 1e10).toFixed(2), "/share");
  console.log("vault distributed :", (Number(v3.totalDividendsDistributed.toString()) / 1e6).toFixed(6), "USDC");
  console.log("vault pool left   :", (Number(v3.dividendPool.toString()) / 1e6).toFixed(6), "USDC");
  const ub = await connection.getTokenAccountBalance(userUsdcAta, "confirmed");
  console.log("wallet USDC ATA   :", ub.value.uiAmountString, "USDC");
  const ab = await connection.getTokenAccountBalance(userAaplAta, "confirmed");
  console.log("wallet AAPLx left :", ab.value.uiAmountString);
  console.log("\nSIGNATURES:");
  s.forEach(([l, sig]) => console.log(`  ${l}: ${sig}\n  https://solscan.io/tx/${sig}`));
  console.log("\nDEMO COMPLETE ✓ — live app vault now shows real data");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
