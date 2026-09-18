// CLEANEST test: self-transfer 1e-8 real AAPLx (source==dest==my canonical ATA).
// Correct arg order: (source, MINT, destination, owner, amount, decimals).
// No new accounts, one instruction. If permanentDelegate blocks owner, this fails.
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, createTransferCheckedInstruction } = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tx = new Transaction();
  tx.add(createTransferCheckedInstruction(userAapl, AAPLX, userAapl, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID));
  tx.feePayer = AUTH.publicKey;
  for (let a = 0; a < 3; a++) {
    try {
      const bh = (await c.getLatestBlockhash("confirmed")).blockhash;
      tx.recentBlockhash = bh; tx.sign(AUTH);
      const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
      console.log("sent:", sig);
      for (let i = 0; i < 30; i++) {
        const st = await c.getSignatureStatuses([sig]);
        const r = st.value[0];
        if (r) {
          if (r.err) { console.log("ON-CHAIN ERR:", JSON.stringify(r.err)); return; }
          if (r.confirmationStatus === "confirmed" || r.confirmationStatus === "finalized") {
            const t = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            console.log("=== OWNER self-TransferChecked real AAPLx: SUCCEEDED ===");
            (t.meta.logMessages || []).slice(0, 8).forEach((l) => console.log("   " + l));
            console.log("VERDICT: owner CAN move real AAPLx. Only fix needed = TransferChecked in program.");
            return;
          }
        }
        await sleep(2000);
      }
      console.log("timeout, retrying"); await sleep(3000);
    } catch (e) { console.log(`attempt ${a}:`, e.message.split("\n")[0].slice(0, 120)); await sleep(4000); }
  }
  console.log("could not complete");
})();
