// READ-ONLY simulation: can the OWNER move real AAPLx (Backed xStock, Token-2022)?
// Tests both plain Transfer (what the DEPLOYED program uses) and TransferChecked (the fix).
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction } = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} = require("@solana/spl-token");
const fs = require("fs");

const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1"); // owner's AAPLx ATA (0.01191443)
function le64(n){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;}

(async () => {
  // dest ATA for a throwaway owner
  const dest = getAssociatedTokenAddressSync(AAPLX, Keypair.generate().publicKey, false, TOKEN_2022_PROGRAM_ID);

  // [A] PLAIN Transfer (instruction #3) — exactly what the DEPLOYED program issues
  const plainIx = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: userAapl, isWritable: true, isSigner: false },
      { pubkey: dest,     isWritable: true, isSigner: false },
      { pubkey: AUTH.publicKey, isWritable: false, isSigner: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.concat([Buffer.from([3]), le64(1)]),
  });
  const tA = new Transaction().add(plainIx);
  tA.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tA.feePayer = AUTH.publicKey; tA.sign(AUTH);
  const simA = await c.simulateTransaction(tA);
  console.log("[A] PLAIN Transfer (deployed program's path):", simA.value.success ? "SUCCESS" : "FAIL", simA.value.err ? JSON.stringify(simA.value.err) : "");
  (simA.value.logMessages||[]).slice(0,10).forEach(l=>console.log("     | "+l));

  // [B] TransferChecked (instruction #18) — the working-tree FIX
  const tchIx = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: userAapl, isWritable: true, isSigner: false },
      { pubkey: dest,     isWritable: true, isSigner: false },
      { pubkey: AAPLX,    isWritable: false, isSigner: false },
      { pubkey: AUTH.publicKey, isWritable: false, isSigner: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.concat([Buffer.from([18]), le64(1), Buffer.from([8])]),
  });
  const tB = new Transaction().add(tchIx);
  tB.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tB.feePayer = AUTH.publicKey; tB.sign(AUTH);
  const simB = await c.simulateTransaction(tB);
  console.log("\n[B] TransferChecked (the fix):", simB.value.success ? "SUCCESS" : "FAIL", simB.value.err ? JSON.stringify(simB.value.err) : "");
  (simB.value.logMessages||[]).slice(0,10).forEach(l=>console.log("     | "+l));

  console.log("\n=== VERDICT ===");
  if (simA.value.success) console.log("Real AAPLx ACCEPTS plain Transfer -> DEPLOYED program already works, no funding needed.");
  else if (simB.value.success) console.log("Real AAPLx rejects plain Transfer but ACCEPTS TransferChecked -> upgrade (0.0269 SOL) makes flagship use work.");
  else console.log("Real AAPLx rejects BOTH -> owner cannot move real AAPLx at all; flagship use is impossible regardless of funding.");
})().catch(e=>{console.error("ERR", e.message); process.exit(1);});
