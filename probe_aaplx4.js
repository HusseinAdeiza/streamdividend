// PROBE v4 (final): can the wallet OWNER move real AAPLx via TransferChecked?
// permanentDelegate should block owner-signed transfers.
const { Connection, Keypair, PublicKey, Transaction, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const s_ata = ASSOCIATED_TOKEN_PROGRAM_ID;
const fs = require("fs");

const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
function le64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; }

(async () => {
  const rent = await c.getMinimumBalanceForRentExemption(165);
  const throwaway = Keypair.generate();
  const dest = getAssociatedTokenAddressSync(AAPLX, throwaway.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // 1) fund throwaway + create its AAPLx ATA (idempotent, correct T2022 programs)
  const bh = (await c.getLatestBlockhash("confirmed")).blockhash;
  const tx1 = new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: AUTH.publicKey, toPubkey: throwaway.publicKey, lamports: rent }))
    .add(createAssociatedTokenAccountIdempotentInstruction(AUTH.publicKey, dest, throwaway.publicKey, AAPLX, TOKEN_2022_PROGRAM_ID, s_ata));
  tx1.recentBlockhash = bh; tx1.feePayer = AUTH.publicKey; tx1.sign(AUTH);
  const sim1 = await c.simulateTransaction(tx1);
  console.log("[1 create throwaway AAPLx ATA]", JSON.stringify(sim1.value).slice(0, 300));
  if (sim1.value.err) return console.log("create ATA failed:", JSON.stringify(sim1.value.err));
  const sigA = await c.sendRawTransaction(tx1.serialize(), { maxRetries: 3 });
  await c.confirmTransaction(sigA, "confirmed");
  console.log("     sig:", sigA.slice(0, 24) + "...  dest:", dest.toBase58());

  // 2) THE test: OWNER signs TransferChecked of 1e-8 real AAPLx
  const tch = new Transaction();
  tch.add(new (require("@solana/web3.js").TransactionInstruction)({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: userAapl, isWritable: true, isSigner: false },
      { pubkey: dest, isWritable: true, isSigner: false },
      { pubkey: AAPLX, isWritable: false, isSigner: false },
      { pubkey: AUTH.publicKey, isWritable: false, isSigner: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
    data: Buffer.concat([Buffer.from([18]), le64(1n), Buffer.from([8])]),
  }));
  tch.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tch.feePayer = AUTH.publicKey; tch.sign(AUTH);
  const sim2 = await c.simulateTransaction(tch);
  console.log("\n[2 OWNER TransferChecked real AAPLx]", sim2.value.success ? "SUCCESS — owner can move AAPLx" : "FAIL " + JSON.stringify(sim2.value.err));
  (sim2.value.logMessages || []).slice(0, 8).forEach((l) => console.log("   " + l));

  console.log(sim2.value.success
    ? "\nVERDICT: owner CAN transfer real AAPLx (TransferChecked). Program fix = TransferChecked only."
    : "\nVERDICT: owner CANNOT transfer real AAPLx -> permanentDelegate locks transfers. Real-AAPLx deposit is impossible for any user.");
})();
