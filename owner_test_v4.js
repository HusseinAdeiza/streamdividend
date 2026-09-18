// Robust: create ATA (with retries) then owner TransferChecked 1e-8 real AAPLx.
const { Connection, Keypair, PublicKey, Transaction, SystemProgram } = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sendConfirm(tx, label) {
  for (let a = 0; a < 4; a++) {
    tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(AUTH);
    const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 }).catch((e) => e.message);
    if (typeof sig === "string" && sig.includes("Message")) { await sleep(2500); continue; }
    // poll status
    for (let i = 0; i < 25; i++) {
      const st = await c.getSignatureStatuses([sig]).catch(() => null);
      const r = st && st.value[0];
      if (r) {
        if (r.err) throw new Error(label + " on-chain error: " + JSON.stringify(r.err));
        if (r.confirmationStatus === "confirmed" || r.confirmationStatus === "finalized") return sig;
      }
      await sleep(2000);
    }
    throw new Error(label + " confirm timeout");
  }
  throw new Error(label + " send retries exhausted");
}

(async () => {
  const owner = Keypair.generate();
  const destAta = getAssociatedTokenAddressSync(AAPLX, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  console.log("throwaway owner:", owner.publicKey.toBase58());
  console.log("dest ATA        :", destAta.toBase58());

  // step 1: fund + ATA
  const rent = await c.getMinimumBalanceForRentExemption(165);
  const tx1 = new Transaction();
  tx1.add(SystemProgram.transfer({ fromPubkey: AUTH.publicKey, toPubkey: owner.publicKey, lamports: rent }));
  tx1.add(createAssociatedTokenAccountIdempotentInstruction(AUTH.publicKey, destAta, owner.publicKey, AAPLX, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  tx1.feePayer = AUTH.publicKey;
  const s1 = await sendConfirm(tx1, "ATA-create");
  console.log("ATA created:", s1.slice(0, 20) + "...");

  // step 2: THE TEST — owner-signed TransferChecked 1e-8 real AAPLx (correct arg order)
  const tx2 = new Transaction();
  tx2.add(createTransferCheckedInstruction(userAapl, AAPLX, destAta, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID));
  tx2.feePayer = AUTH.publicKey;
  try {
    const s2 = await sendConfirm(tx2, "TransferChecked");
    const t2 = await c.getTransaction(s2, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    console.log("\n=== OWNER TransferChecked real AAPLx: SUCCEEDED ===  sig:", s2);
    (t2.meta.logMessages || []).slice(0, 8).forEach((l) => console.log("   " + l));
    console.log("\nVERDICT: owner CAN move real AAPLx via TransferChecked (correct arg order).");
    console.log("=> The only program bug is plain Transfer vs TransferChecked. Fix + redeploy = real deposits work.");
  } catch (e) {
    console.log("\n=== OWNER TransferChecked real AAPLx: FAILED ===");
    console.log(e.message);
  }
})();
