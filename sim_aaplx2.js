// READ-ONLY sim, v2: create the dest ATA on-chain (rent ~0.0015 SOL from existing balance),
// then re-simulate plain Transfer vs TransferChecked of real AAPLx.
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
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
function le64(n){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

(async () => {
  const destOwner = Keypair.generate();
  const dest = getAssociatedTokenAddressSync(AAPLX, destOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  console.log("throwaway owner:", destOwner.publicKey.toBase58());
  console.log("dest ATA        :", dest.toBase58());

  // create dest ATA (idempotent) on-chain
  const rent = await c.getMinimumBalanceForRentExemption(165);
  const tx1 = new Transaction();
  tx1.add(SystemProgram.transfer({ fromPubkey: AUTH.publicKey, toPubkey: destOwner.publicKey, lamports: rent }));
  tx1.add(createAssociatedTokenAccountIdempotentInstruction(AUTH.publicKey, dest, destOwner.publicKey, AAPLX, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  tx1.feePayer = AUTH.publicKey;
  let sig;
  for (let a=0;a<4;a++){
    tx1.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
    tx1.sign(AUTH);
    sig = await c.sendRawTransaction(tx1.serialize(), { maxRetries: 3 }).catch(e=>e.message);
    if (typeof sig === "string") { await sleep(3000); continue; }
    for (let i=0;i<30;i++){
      const st = await c.getSignatureStatuses([sig]).catch(()=>null);
      const r = st && st.value[0];
      if (r){ if (r.err) throw new Error("ATA create err: "+JSON.stringify(r.err)); if (r.confirmationStatus!=="finalized") { await sleep(2000); continue; } break; }
      await sleep(2000);
    }
    console.log("ATA created sig:", sig);
    break;
  }

  const bh = (await c.getLatestBlockhash("confirmed")).blockhash;

  // [A] PLAIN Transfer (deployed program's exact path)
  const tA = new Transaction().add(new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: userAapl, isWritable: true, isSigner: false },
      { pubkey: dest,     isWritable: true, isSigner: false },
      { pubkey: AUTH.publicKey, isWritable: false, isSigner: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.concat([Buffer.from([3]), le64(1)]),
  }));
  tA.recentBlockhash = bh; tA.feePayer = AUTH.publicKey; tA.sign(AUTH);
  const simA = await c.simulateTransaction(tA);
  console.log("\n[A] PLAIN Transfer (deployed program's path):", simA.value.success ? "SUCCESS" : "FAIL", simA.value.err ? JSON.stringify(simA.value.err) : "");
  (simA.value.logMessages||[]).slice(0,12).forEach(l=>console.log("     | "+l));

  // [B] TransferChecked (the fix)
  const tB = new Transaction().add(new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: userAapl, isWritable: true, isSigner: false },
      { pubkey: dest,     isWritable: true, isSigner: false },
      { pubkey: AAPLX,    isWritable: false, isSigner: false },
      { pubkey: AUTH.publicKey, isWritable: false, isSigner: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.concat([Buffer.from([18]), le64(1), Buffer.from([8])]),
  }));
  tB.recentBlockhash = bh; tB.feePayer = AUTH.publicKey; tB.sign(AUTH);
  const simB = await c.simulateTransaction(tB);
  console.log("\n[B] TransferChecked (the fix):", simB.value.success ? "SUCCESS" : "FAIL", simB.value.err ? JSON.stringify(simB.value.err) : "");
  (simB.value.logMessages||[]).slice(0,12).forEach(l=>console.log("     | "+l));

  console.log("\n=== VERDICT ===");
  if (simA.value.success) console.log("AAPLx ACCEPTS plain Transfer -> DEPLOYED program already works, no funding needed.");
  else if (simB.value.success) console.log("AAPLx rejects plain Transfer, ACCEPTS TransferChecked -> upgrade (0.0269 SOL) makes flagship use work.");
  else console.log("AAPLx rejects BOTH -> real-AAPLx deposits impossible regardless of funding.");
})().catch(e=>{console.error("ERR", e.message); process.exit(1);});
