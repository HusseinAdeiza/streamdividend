// Diagnose: extensions on both token accounts + self-transfer test.
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, createTransferCheckedInstruction } = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
const dest = new PublicKey("8jmfotEdKuhhfFvWTwnQmdAFUaQMwqTrWZ4sxnox39pv");

(async () => {
  for (const [name, pk] of [["user AAPLx ATA", userAapl], ["dest ATA", dest]]) {
    const r = await c.getParsedAccountInfo(pk);
    const exts = (r.value.data.parsed.info.extensions || []).map((e) => e.extension);
    console.log(`${name}: extensions=[${exts.join(", ")}]`);
    const ct = (r.value.data.parsed.info.extensions || []).find((e) => e.extension === "confidentialTransferAccount");
    if (ct) console.log("   confidentialTransferAccount state:", JSON.stringify(ct.state));
  }

  // self-transfer test: userAapl -> userAapl, 1 unit, owner AUTH
  const ix = createTransferCheckedInstruction(userAapl, userAapl, AAPLX, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  const sim = await c.simulateTransaction(tx);
  console.log("\n[SELF-transfer 1e-8 userAapl->userAapl] err:", JSON.stringify(sim.value.err));
  (sim.value.logMessages || []).slice(0, 10).forEach((l) => console.log("   " + l));
})();
