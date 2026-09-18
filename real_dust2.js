// Is 8jmfot... the canonical ATA of owner 8ikcLty... for AAPLx?
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const owner = new PublicKey("8ikcLtye76zB4Maq3JsLNo6Q898dECdbbdbpNGKe2wx3");
const dest  = new PublicKey("8jmfotEdKuhhfFvWTwnQmdAFUaQMwqTrWZ4sxnox39pv");

const canon = getAssociatedTokenAddressSync(AAPLX, owner, false, TOKEN_2022_PROGRAM_ID);
console.log("canonical ATA(owner 8ikcLty, AAPLx):", canon.toBase58());
console.log("on-chain dest                     :", dest.toBase58());
console.log("MATCH:", canon.toBase58() === dest.toBase58());

// Also: maybe dest's owner shown is stale. Derive ATA for AUTH as a known-good dest.
const authAapl = getAssociatedTokenAddressSync(AAPLX, AUTH.publicKey, false, TOKEN_2022_PROGRAM_ID);
console.log("\nAUTH canonical AAPLx ATA:", authAapl.toBase58(), "(this is 2Mwkof... = the funded one)");

// The definitive owner-transfer test, dest = AUTH's OWN AAPLx ATA (self-transfer).
// Self-transfer to the canonical ATA removes ATA-canonicity as a variable.
const { createTransferCheckedInstruction } = require("@solana/spl-token");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
(async () => {
  const ix = createTransferCheckedInstruction(userAapl, authAapl, AAPLX, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction(); tx.add(ix);
  tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  let sig;
  try {
    sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    console.log("SENT self-transfer sig:", sig);
    await c.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash, lastValidBlockHeight: await c.getBlockHeight() }, "confirmed");
    const txres = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    console.log("SUCCESS — owner CAN move real AAPLx");
    (txres.meta.logMessages || []).slice(0, 8).forEach((l) => console.log("   " + l));
  } catch (e) {
    console.log("FAILED:", e.message.split("\n").slice(0, 14).join("\n"));
  }
})();
