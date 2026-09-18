// Full-logs version: confirm WHY owner TransferChecked of real AAPLx fails.
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, createTransferCheckedInstruction } = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
const dest = new PublicKey("8jmfotEdKuhhfFvWTwnQmdAFUaQMwqTrWZ4sxnox39pv"); // valid AAPLx ATA

(async () => {
  const ix = createTransferCheckedInstruction(userAapl, dest, AAPLX, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  const sim = await c.simulateTransaction(tx);
  console.log("err:", JSON.stringify(sim.value.err));
  console.log("\nFULL LOGS:");
  (sim.value.logMessages || []).forEach((l) => console.log("  " + l));
})();
