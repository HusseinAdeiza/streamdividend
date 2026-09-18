// A/B demo — PHASE A: OLD binary (== live mainnet) vs AAPLx-clone mint.
// Creates state, attempts a deposit, EXPECTS failure (Custom 31).
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
  // AAPLx CLONE: T2022 mint + permanentDelegate (the exact extension real AAPLx carries)
  const delegate = Keypair.generate().publicKey;
  const xstockMint = await createMint(conn, PAYER, PAYER.publicKey, null, 8, undefined, undefined, T2022);
  // initialize permanentDelegate BEFORE any token account exists (extension init constraint)
  {
    const t = new Transaction().add(createInitializePermanentDelegateInstruction(xstockMint, delegate, T2022));
    await sendAndConfirmTransaction(conn, t, [PAYER]);
  }
  const usdcMint = await createMint(conn, PAYER, PAYER.publicKey, null, 6, undefined, undefined, TOKEN_PROG);
  console.log("USDC(v3) mint:", usdcMint.toBase58());

  const [vault] = pda(["vault", auth.toBuffer()]);
  const [userState] = pda(["user", vault.toBuffer(), auth.toBuffer()]);
  const userXstock = getAssociatedTokenAddressSync(xstockMint, auth, false, T2022);
  const userDividend = getAssociatedTokenAddressSync(usdcMint, auth);
  const vaultXstock = getAssociatedTokenAddressSync(xstockMint, vault, true, T2022);
  const vaultDividend = getAssociatedTokenAddressSync(usdcMint, vault, true);

  const ONE_M = 1_000_000 * 1e8;
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
  fs.writeFileSync("/tmp/ab_state.json", JSON.stringify({
    xstockMint: xstockMint.toBase58(), usdcMint: usdcMint.toBase58(),
    vault: vault.toBase58(), userState: userState.toBase58(),
    userXstock: userXstock.toBase58(), userDividend: userDividend.toBase58(),
    vaultXstock: vaultXstock.toBase58(), vaultDividend: vaultDividend.toBase58(),
  }));

  console.log("=== PHASE A: OLD (live-mainnet) binary, deposit real-AAPLx-style token ===");
  try {
    await program.methods.deposit(new BN(100 * 1e8)).accounts({
      user: auth, vault, userState, userXstock, vaultXstock, xstockMint,
      systemProgram: SYS, tokenProgram: T2022,
    }).rpc();
    console.log("UNEXPECTED: deposit succeeded on old binary");
    process.exit(1);
  } catch (e) {
    const msg = e.message || String(e);
    const code = msg.match(/custom program error: 0x([0-9a-f]+)/);
    const custom = code ? parseInt(code[1],16) : null;
    console.log("PHASE A deposit FAILED: custom error", custom,
      custom === 31 ? "= MintRequiredForTransfer (the EXACT mainnet AAPLx failure)" : "");
    if (custom !== 31) { console.log(msg.slice(0,300)); process.exit(1); }
  }
  console.log("\nPHASE A complete. Redeploy the FIXED binary, then run phase B.");
})().catch(e => { console.error("FATAL", e); process.exit(1); });
