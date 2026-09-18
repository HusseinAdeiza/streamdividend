// A/B demo on local validator:
//   mint = real-AAPLx clone (T2022 + permanentDelegate)
//   A) OLD binary (sha 6876d0e5 = exactly what is live on mainnet) -> deposit must FAIL (MintRequiredForTransfer, 0x1f/31)
//   B) NEW binary (sha bb0b9e50, the fix)                          -> deposit + full flow must PASS
const { Connection, PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { Program, AnchorProvider, BN } = require("@coral-xyz/anchor");
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createMint, mintTo, createAssociatedTokenAccountIdempotent,
  createInitializePermanentDelegateInstruction,
} = require("@solana/spl-token");
const fs = require("fs");

const idl = require("/root/streamdividend/target/idl/streamdividend.json");
const PROGRAM = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
const TOKEN_PROG = new PublicKey(TOKEN_PROGRAM_ID);
const T2022 = new PublicKey(TOKEN_2022_PROGRAM_ID);
const SYS = SystemProgram.programId;
const A_TOKEN = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const PAYER = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync("/root/.config/solana/id.json","utf8"))));
const conn = new Connection("http://localhost:8899","confirmed");
const wallet = { publicKey: PAYER.publicKey,
  signTransaction: async (tx)=>{tx.partialSign(PAYER);return tx;},
  signAllTransactions: async (t)=>t.map(tx=>{tx.partialSign(PAYER);return tx;}) };
const provider = new AnchorProvider(conn, wallet, {});
const program = new Program(idl, PROGRAM, provider);
const pda = (s)=> PublicKey.findProgramAddressSync(s.map(x=>Buffer.from(x)), PROGRAM)[0];

const ataIx = (ata, owner, mint, tokenProg) => new TransactionInstruction({
  keys: [
    { pubkey: PAYER.publicKey, isSigner: true, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SYS, isSigner: false, isWritable: false },
    { pubkey: tokenProg, isSigner: false, isWritable: false },
  ],
  programId: A_TOKEN, data: Buffer.from([1]),
});

(async () => {
  const auth = PAYER.publicKey;
  // 1) Build the AAPLx CLONE: T2022 mint + permanentDelegate (exactly the extension real AAPLx has)
  const delegate = Keypair.generate().publicKey;
  const xstockMint = await createMint(conn, PAYER, PAYER.publicKey, null, 8, undefined, undefined, T2022);
  const pdIx = createInitializePermanentDelegateInstruction(xstockMint, delegate, T2022);
  {
    const t = new Transaction().add(pdIx);
    await sendAndConfirmTransaction(conn, t, [PAYER]);
  }
  const usdcMint = await createMint(conn, PAYER, PAYER.publicKey, null, 6, undefined, undefined, TOKEN_PROG);
  console.log("AAPLx-clone mint:", xstockMint.toBase58(), "(T2022 + permanentDelegate, 8 dec)");
  console.log("USDC(v3) mint:   ", usdcMint.toBase58());

  const [vault] = pda(["vault", auth.toBuffer()]);
  const [userState] = pda(["user", vault.toBuffer(), auth.toBuffer()]);
  const userXstock = getAssociatedTokenAddressSync(xstockMint, auth, false, T2022);
  const userDividend = getAssociatedTokenAddressSync(usdcMint, auth);
  const vaultXstock = getAssociatedTokenAddressSync(xstockMint, vault, true, T2022);
  const vaultDividend = getAssociatedTokenAddressSync(usdcMint, vault, true);

  const ONE_M = 1_000_000 * 1e8; // 1,000,000 tokens at 8 dec
  await createAssociatedTokenAccountIdempotent(conn, PAYER, xstockMint, PAYER.publicKey, undefined, T2022);
  await createAssociatedTokenAccountIdempotent(conn, PAYER, usdcMint, PAYER.publicKey);
  await mintTo(conn, PAYER, xstockMint, userXstock, PAYER.publicKey, ONE_M, undefined, undefined, T2022);
  await mintTo(conn, PAYER, usdcMint, userDividend, PAYER.publicKey, 1_000_000 * 1e6);

  await program.methods.initialize().accounts({
    authority: auth, vault, xstockMint, dividendMint: usdcMint, systemProgram: SYS,
  }).rpc();
  {
    const t1 = new Transaction().add(ataIx(vaultXstock, vault, xstockMint, T2022));
    await sendAndConfirmTransaction(conn, t1, [PAYER]);
    const t2 = new Transaction().add(ataIx(vaultDividend, vault, usdcMint, TOKEN_PROG));
    await sendAndConfirmTransaction(conn, t2, [PAYER]);
  }
  console.log("vault initialized with AAPLx-clone. === PHASE A: OLD (live-mainnet) binary ===");

  // PHASE A: old binary -> deposit should fail with MintRequiredForTransfer (Custom 31)
  try {
    await program.methods.deposit(new BN(100 * 1e8)).accounts({
      user: auth, vault, userState, userXstock, vaultXstock, xstockMint,
      systemProgram: SYS, tokenProgram: T2022,
    }).rpc();
    console.log("PHASE A: deposit UNEXPECTEDLY SUCCEEDED");
    process.exit(1);
  } catch (e) {
    const msg = e.message || String(e);
    const code = msg.match(/custom program error: 0x([0-9a-f]+)/);
    const custom = code ? parseInt(code[1],16) : null;
    console.log("PHASE A: deposit FAILED as expected on real-AAPLx-style mint");
    console.log("  custom error:", custom, custom===31 ? "(31 = MintRequiredForTransfer — the EXACT mainnet failure)" : "");
    if (custom !== 31) { console.log("  detail:", msg.slice(0,200)); process.exit(1); }
  }

  console.log("\n=== PHASE B: redeploy FIXED binary (same program ID) ===");
  // (deploy happens between phases, outside this script)
  // PHASE B: new binary -> full flow must pass
  const steps = [];
  const step = async (name, fn) => {
    try { await fn(); console.log("✓ " + name); steps.push([name, "PASS"]); }
    catch (e) { console.log("✗ " + name + " → " + (e.message||"").split("\n")[0]); steps.push([name, "FAIL"]); }
  };

  await step("deposit 100 xStock", () => program.methods.deposit(new BN(100 * 1e8)).accounts({
    user: auth, vault, userState, userXstock, vaultXstock, xstockMint,
    systemProgram: SYS, tokenProgram: T2022,
  }).rpc());
  await step("triggerDividend 50 USDC", () => program.methods.triggerDividend(new BN(50 * 1e6)).accounts({
    authority: auth, vault, adminDividend: userDividend, vaultDividend, dividendMint: usdcMint,
    systemProgram: SYS, tokenProgram: TOKEN_PROG,
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
    systemProgram: SYS, tokenProgram: T2022,
  }).rpc());

  const v = await program.account.vault.fetch(vault);
  const balDiv = await conn.getTokenAccountBalance(userDividend);
  const balX = await conn.getTokenAccountBalance(userXstock);
  const got = Number(balDiv.value.uiAmountString);
  const xs = Number(balX.value.uiAmountString);
  console.log("\nuser USDC:", balDiv.value.uiAmountString, "(expect 1,000,000)");
  console.log("user xStock:", balX.value.uiAmountString, "(expect 999,930)");
  const ok1 = Math.abs(got - 1_000_000) < 1;
  const ok2 = Math.abs(xs - 999_930) < 1;
  console.log("INV1 USDC:", ok1 ? "PASS" : "FAIL", " INV2 xStock:", ok2 ? "PASS" : "FAIL");

  const passed = steps.filter(s=>s[1]==="PASS").length;
  console.log("\n=== A/B RESULT: PHASE A (old/live) failed as expected; PHASE B (fixed) " + passed + "/5 steps, invariants " + (ok1&&ok2?"PASS":"FAIL") + " ===");
  if (passed !== 5 || !ok1 || !ok2) process.exitCode = 1;
})().catch(e => { console.error("FATAL", e); process.exit(1); });
