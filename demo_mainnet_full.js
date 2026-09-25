// MAINNET REAL DEMO — full four-step custodial dividend flow, signed by the
// authority wallet (4KTQi…). Produces real, Solscan-verifiable on-chain state.
//   1) Deposit ALL AAPLx (Token-2022) into the live vault
//   2) Trigger a USDC dividend (per-share accumulator)
//   3) Claim the accrued USDC into the wallet's USDC ATA
//   4) Withdraw the AAPLx back to the wallet (custody round-trip)
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

const vAapl = new PublicKey("E4qLqRdxvv1HTAS7gePCq9JMaNhE1BpXh3WUEJjezpsk"); // on-chain vault AAPLx ATA
const vUsdc = new PublicKey("3khNwQmsAwXaeLZe4dWGtpEfs7FjQpjEqhPjZyeGydQg"); // on-chain vault USDC ATA

async function bal(ata) { return (await connection.getTokenAccountBalance(ata, "confirmed")).value; }
async function sendTx(tx, label) {
  const bh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.recentBlockhash = bh; tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  console.log(label, "sig:", sig);
  const conf = await connection.confirmTransaction(sig, "confirmed");
  if (conf.value.err) { console.error(label, "TX ERR:", JSON.stringify(conf.value.err)); process.exit(1); }
  console.log(label, "confirmed ✓");
  return sig;
}
async function dump(i, label) {
  const vi = await connection.getAccountInfo(vault, "confirmed");
  const v = program.coder.accounts.decode("Vault", vi.data);
  console.log(`--- ${label} ---`);
  console.log("  totalShares:", v.totalShares.toString(), "=", Number(v.totalShares)/1e8, "AAPLx");
  console.log("  dividendsPerShare:", v.dividendsPerShare.toString(), "(plain).  $/share:", (Number(v.dividendsPerShare)/1e10).toFixed(4));
  console.log("  distributed:", (Number(v.totalDividendsDistributed)/1e6).toFixed(6), "USDC  pool:", (Number(v.dividendPool)/1e6).toFixed(6), "USDC");
  console.log("  wallet USDC:", (await bal(userUsdcAta)).uiAmountString, "  wallet AAPLx:", (await bal(userAaplAta)).uiAmountString);
  console.log("  vault AAPLx ATA:", (await bal(vAapl)).uiAmountString, "  vault USDC ATA:", (await bal(vUsdc)).uiAmountString);
}

(async () => {
  const sigs = [];

  // STEP 1: DEPOSIT all AAPLx
  const dep = await bal(userAaplAta);
  console.log(`\n[1/4] DEPOSIT ${dep.uiAmountString} AAPLx (${dep.amount} base, Token-2022)`);
  const t1 = await program.methods.deposit(new BN(dep.amount)).accounts({
    user: AUTH.publicKey, vault, userState, userXstock: userAaplAta, vaultXstock: vAapl,
    xstockMint: AAPLX_MINT, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022,
  }).transaction();
  sigs.push(["deposit", await sendTx(t1, "  deposit")]);
  await dump(1, "after deposit");

  // STEP 2: TRIGGER dividend -> $0.27/share (Apple's real quarterly rate)
  const vi = await connection.getAccountInfo(vault, "confirmed");
  const v = program.coder.accounts.decode("Vault", vi.data);
  const totalShares = Number(v.totalShares.toString());
  const dps = 2_700_000_000n; // 2.7e9 => $0.27/share
  const triggerAmt = Number((dps * BigInt(totalShares)) / 1_000_000_000_000n);
  console.log(`\n[2/4] TRIGGER ${(triggerAmt/1e6).toFixed(6)} USDC (=$0.27/share x ${totalShares/1e8} AAPLx)`);
  const t2 = await program.methods.triggerDividend(new BN(triggerAmt)).accounts({
    vault, authority: AUTH.publicKey, adminDividend: userUsdcAta, vaultDividend: vUsdc,
    dividendMint: USDC_MINT, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROG,
  }).transaction();
  sigs.push(["trigger", await sendTx(t2, "  trigger")]);
  await dump(2, "after trigger");

  // STEP 3: CLAIM accrued USDC
  const t3 = await program.methods.claimDividend().accounts({
    vault, userState, user: AUTH.publicKey, userDividend: userUsdcAta, vaultDividend: vUsdc,
    dividendMint: USDC_MINT, tokenProgram: TOKEN_PROG,
  }).transaction();
  sigs.push(["claim", await sendTx(t3, "  claim")]);
  await dump(3, "after claim");

  // STEP 4: WITHDRAW custody round-trip (all shares)
  const us = program.coder.accounts.decode("UserState", (await connection.getAccountInfo(userState, "confirmed")).data);
  console.log(`\n[4/4] WITHDRAW ${us.shares.toString()} shares (all)`);
  const t4 = await program.methods.withdraw(us.shares).accounts({
    vault, userState, user: AUTH.publicKey, userXstock: userAaplAta, vaultXstock: vAapl,
    userDividend: userUsdcAta, vaultDividend: vUsdc, xstockMint: AAPLX_MINT, dividendMint: USDC_MINT,
    tokenProgram: TOKEN_2022, usdcTokenProgram: TOKEN_PROG,
  }).transaction();
  sigs.push(["withdraw", await sendTx(t4, "  withdraw")]);
  await dump(4, "after withdraw");

  console.log("\n=== SIGNATURES (Solscan) ===");
  sigs.forEach(([l, s]) => console.log(`  ${l}: https://solscan.io/tx/${s}`));
  console.log("\nDEMO COMPLETE ✓ — real custodial dividend round-trip on mainnet");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });