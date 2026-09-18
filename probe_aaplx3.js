// PROBE v3: definitive — can the owner TransferChecked real AAPLx (permanentDelegate)?
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const fs = require("fs");
const { TOKEN_2022_PROGRAM_ID } = spl;

const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");

function le64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; }

(async () => {
  const throwaway = Keypair.generate();
  // create ATA for throwaway owner (idempotent, real send)
  const ataTx = await spl.createAssociatedTokenAccount(c, AUTH, AAPLX, throwaway.publicKey, undefined, "confirmed", undefined, undefined, TOKEN_2022_PROGRAM_ID);
  ataTx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  ataTx.feePayer = AUTH.publicKey; ataTx.sign(AUTH);
  const sigA = await c.sendRawTransaction(ataTx.serialize(), { maxRetries: 3 });
  await c.confirmTransaction(sigA, "confirmed");
  const dest = spl.getAssociatedTokenAddressSync(AAPLX, throwaway.publicKey, false, TOKEN_2022_PROGRAM_ID);
  console.log("throwaway ATA created:", dest.toBase58());

  // THE test: owner (AUTH) signs TransferChecked of 1e-8 AAPLx
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
  const tx2 = new Transaction().add(tchIx);
  tx2.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx2.feePayer = AUTH.publicKey; tx2.sign(AUTH);
  const sim2 = await c.simulateTransaction(tx2);
  console.log("\n[OWNER TransferChecked real AAPLx] success:", sim2.value.success, "err:", JSON.stringify(sim2.value.err || ""));
  (sim2.value.logMessages || []).slice(0, 10).forEach((l) => console.log("   " + l));
})();
