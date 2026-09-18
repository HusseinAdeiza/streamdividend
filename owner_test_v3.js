// Resume: check dest ATA exists; run the owner TransferChecked with robust confirm.
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
const destAta = new PublicKey("HxYckaG9gqR9WzdwRURBNVhDJWpe6AoQLxzT9apsTvLZ");

async function confirm(sig, bh) {
  for (let i = 0; i < 20; i++) {
    const st = await c.getSignatureStatuses([sig]);
    const r = st.value[0];
    if (r) {
      if (r.confirmationStatus === "confirmed" || r.confirmationStatus === "finalized") return { ok: true, err: r.err };
      if (r.err) return { ok: false, err: r.err };
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  return { ok: false, err: "timeout" };
}

(async () => {
  const exists = await c.getAccountInfo(destAta);
  console.log("dest ATA exists:", !!exists.value);
  if (!exists.value) return console.log("ATA never landed — abort (no transfer).");

  const ix = createTransferCheckedInstruction(userAapl, AAPLX, destAta, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction(); tx.add(ix);
  tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  const s2 = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  console.log("transfer sig:", s2);
  const r = await confirm(s2, tx.recentBlockhash);
  if (r.ok) {
    const t = await c.getTransaction(s2, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    console.log("=== OWNER TransferChecked real AAPLx: SUCCEEDED ===");
    (t.meta.logMessages || []).slice(0, 8).forEach((l) => console.log("   " + l));
    console.log("VERDICT: owner CAN move real AAPLx.");
  } else {
    console.log("=== FAILED ===", JSON.stringify(r.err));
    try {
      const st = await c.getSignatureStatuses([s2]);
      if (st.value[0] && st.value[0].confirmationStatus) {
        const t = await c.getTransaction(s2, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
        (t.meta.logMessages || []).slice(0, 14).forEach((l) => console.log("   " + l));
      }
    } catch (e) {}
  }
})();
