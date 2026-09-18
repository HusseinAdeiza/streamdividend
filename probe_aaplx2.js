// PROBE v2: definitive test — can the wallet owner TransferChecked real AAPLx?
// Creates a fresh throwaway AAPLx ATA (correct mint), then moves 1e-8 dust.
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const fs = require("fs");

const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");

function le64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; }

(async () => {
  const throwaway = Keypair.generate();
  const dest = getAssociatedTokenAddressSync(AAPLX, throwaway.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const bh = (await c.getLatestBlockhash("confirmed")).blockhash;

  // Step A: create ATA for throwaway (funded by AUTH) + step B: TransferChecked 1 unit
  const rent = await c.getMinimumBalanceForRentExemption(165);
  const ix = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: dest, isWritable: true, isSigner: false },
      { pubkey: AAPLX, isWritable: false, isSigner: false },
      { pubkey: throwaway.publicKey, isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.alloc(0), // 0x1 = InitializeAccount3? no — use 0 for InitializeAccount
  });
  const createIx = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: dest, isWritable: true, isSigner: false },
      { pubkey: AAPLX, isWritable: false, isSigner: false },
      { pubkey: throwaway.publicKey, isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    ],
    data: Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]), // InitializeAccount3 = 0x0C? actually 12
  });
  // TransferChecked = 18: [18, u64 amount, u8 decimals]; from,to,mint,authority,program
  const tchIx = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: userAapl, isWritable: true, isSigner: false },
      { pubkey: dest, isWritable: true, isSigner: false },
      { pubkey: AAPLX, isWritable: false, isSigner: false },
      { pubkey: AUTH.publicKey, isWritable: false, isSigner: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.concat([Buffer.from([18]), le64(1n), Buffer.from([8])]),
  });

  // tx1: rent + create ATA
  const tx1 = new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: AUTH.publicKey, toPubkey: throwaway.publicKey, lamports: rent }))
    .add(createIx);
  tx1.recentBlockhash = bh; tx1.feePayer = AUTH.publicKey; tx1.sign(AUTH, throwaway);
  const sim1 = await c.simulateTransaction(tx1);
  console.log("[create throwaway AAPLx ATA] success:", sim1.value.success, JSON.stringify(sim1.value.err || ""));

  if (!sim1.value.success) {
    console.log("Could not create dest; aborting.");
    return;
  }
  // send it for real (small rent cost)
  const sig1 = await c.sendRawTransaction(tx1.serialize(), { maxRetries: 3 });
  await c.confirmTransaction(sig1, "confirmed");
  console.log("ATA created:", dest.toBase58(), "sig:", sig1.slice(0, 20) + "...");

  // tx2: the real test — owner TransferChecked of 1e-8 AAPLx
  const bh2 = (await c.getLatestBlockhash("confirmed")).blockhash;
  const tx2 = new Transaction().add(tchIx);
  tx2.recentBlockhash = bh2; tx2.feePayer = AUTH.publicKey; tx2.sign(AUTH);
  const sim2 = await c.simulateTransaction(tx2);
  console.log("\n[OWNER TransferChecked of real AAPLx] success:", sim2.value.success, "err:", JSON.stringify(sim2.value.err || ""));
  (sim2.value.logMessages || []).slice(0, 10).forEach((l) => console.log("   " + l));
})();
