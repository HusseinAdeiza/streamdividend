// A/B demo — PHASE B: FIXED binary, full flow on the same AAPLx-clone mint/state.
const { Connection, PublicKey, Keypair, SystemProgram, sendAndConfirmTransaction, Transaction } = require("@solana/web3.js");
const { Program, AnchorProvider, BN } = require("@coral-xyz/anchor");
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const fs = require("fs");

const idl = require("/root/streamdividend/target/idl/streamdividend.json");
const PROGRAM = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
const TOKEN_PROG = new PublicKey(TOKEN_PROGRAM_ID);
const T2022 = new PublicKey(TOKEN_2022_PROGRAM_ID);
const PAYER = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync("/root/.config/solana/id.json","utf8"))));
const conn = new Connection("http://localhost:8899","confirmed");
const wallet = { publicKey: PAYER.publicKey,
  signTransaction: async (tx)=>{tx.partialSign(PAYER);return tx;},
  signAllTransactions: async (t)=>t.map(tx=>{tx.partialSign(PAYER);return tx;}) };
const program = new Program(idl, PROGRAM, new AnchorProvider(conn, wallet, {}));

const S = JSON.parse(fs.readFileSync("/tmp/ab_state.json","utf8"));
const auth = PAYER.publicKey;
const xstockMint = new PublicKey(S.xstockMint), usdcMint = new PublicKey(S.usdcMint);
const vault = new PublicKey(S.vault), userState = new PublicKey(S.userState);
const userXstock = new PublicKey(S.userXstock), userDividend = new PublicKey(S.userDividend);
const vaultXstock = new PublicKey(S.vaultXstock), vaultDividend = new PublicKey(S.vaultDividend);

(async () => {
  const steps = [];
  const step = async (name, fn) => {
    try { await fn(); console.log("✓ " + name); steps.push([name, "PASS"]); }
    catch (e) { console.log("✗ " + name + " → " + (e.message||"").split("\n")[0]); steps.push([name, "FAIL"]); }
  };
  console.log("=== PHASE B: FIXED binary, full flow on AAPLx-clone ===");
  await step("deposit 100 xStock (the leg that FAILED on the old binary)", () => program.methods.deposit(new BN(100 * 1e8)).accounts({
    user: auth, vault, userState, userXstock, vaultXstock, xstockMint,
    systemProgram: SystemProgram.programId, tokenProgram: T2022,
  }).rpc());
  await step("triggerDividend 50 USDC", () => program.methods.triggerDividend(new BN(50 * 1e6)).accounts({
    authority: auth, vault, adminDividend: userDividend, vaultDividend, dividendMint: usdcMint,
    systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROG,
  }).rpc());
  await step("claimDividend", () => program.methods.claimDividend().accounts({
    user: auth, vault, userState, userDividend, vaultDividend, dividendMint: usdcMint,
    tokenProgram: TOKEN_PROG,
  }).rpc());
  await step("withdraw 50 shares", () => program.methods.withdraw(new BN(50 * 1e8)).accounts({
    user: auth, vault, userState, userXstock, vaultXstock, userDividend, vaultDividend,
    xstockMint, dividendMint: usdcMint, tokenProgram: T2022, usdcTokenProgram: TOKEN_PROG,
  }).rpc());
  await step("re-deposit 20 xStock (pro-rata)", () => program.methods.deposit(new BN(20 * 1e8)).accounts({
    user: auth, vault, userState, userXstock, vaultXstock, xstockMint,
    systemProgram: SystemProgram.programId, tokenProgram: T2022,
  }).rpc());

  const balDiv = await conn.getTokenAccountBalance(userDividend);
  const balX = await conn.getTokenAccountBalance(userXstock);
  const got = Number(balDiv.value.uiAmountString), xs = Number(balX.value.uiAmountString);
  console.log("\nuser USDC:   ", balDiv.value.uiAmountString, "(expect 1,000,000)");
  console.log("user xStock: ", balX.value.uiAmountString, "(expect 999,930)");
  const ok1 = Math.abs(got-1e6)<1, ok2 = Math.abs(xs-999930)<1;
  console.log("INV1 USDC:", ok1?"PASS":"FAIL", " INV2 xStock:", ok2?"PASS":"FAIL");
  const passed = steps.filter(s=>s[1]==="PASS").length;
  console.log("\n=== A/B RESULT ===");
  console.log("PHASE A (old/live binary): deposit FAILED — MintRequiredForTransfer (real AAPLx can't be serviced)");
  console.log("PHASE B (fixed binary):   " + passed + "/5 steps, invariants " + (ok1&&ok2?"PASS":"FAIL"));
  if (passed!==5 || !ok1 || !ok2) process.exitCode = 1;
})().catch(e => { console.error("FATAL", e); process.exit(1); });
