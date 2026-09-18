// PROBE: can the wallet owner move real AAPLx?
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token");
const fs = require("fs");

const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
const dest = new PublicKey("AX3me5NR7ZL3kHB1Rcase5Z4yVReLqUgZdh6z4JW9iAA");
const AMT = 1n;

function le64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; }
function le128(n) { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt.asUintN(64, n)); return b; }

(async () => {
  const bh = (await c.getLatestBlockhash("confirmed")).blockhash;

  // plain Transfer: data=[3u8, u64 LE]; keys from,to,authority,program
  const plainIx = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: userAapl, isWritable: true, isSigner: false },
      { pubkey: dest, isWritable: true, isSigner: false },
      { pubkey: AUTH.publicKey, isWritable: false, isSigner: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.concat([Buffer.from([3]), le64(AMT)]),
  });
  let tx1 = new Transaction(); tx1.add(plainIx); tx1.recentBlockhash = bh; tx1.feePayer = AUTH.publicKey; tx1.sign(AUTH);

  // TransferChecked: data=[18u8, u64 LE amount, u8 decimals]; keys from,to,mint,authority,program
  const tchIx = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: userAapl, isWritable: true, isSigner: false },
      { pubkey: dest, isWritable: true, isSigner: false },
      { pubkey: AAPLX, isWritable: false, isSigner: false },
      { pubkey: AUTH.publicKey, isWritable: false, isSigner: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.concat([Buffer.from([18]), le64(AMT), Buffer.from([8])]),
  });
  let tx2 = new Transaction(); tx2.add(tchIx); tx2.recentBlockhash = bh; tx2.feePayer = AUTH.publicKey; tx2.sign(AUTH);

  for (const [label, tx] of [["plain Transfer", tx1], ["TransferChecked", tx2]]) {
    const sim = await c.simulateTransaction(tx);
    console.log(`\n[${label}] success=${sim.value.success} err=${JSON.stringify(sim.value.err)}`);
    (sim.value.logMessages || []).slice(0, 10).forEach((l) => console.log("   " + l));
  }
  console.log("\n>>> If both fail: real AAPLx is NOT owner-transferable (permanentDelegate).");
})();
