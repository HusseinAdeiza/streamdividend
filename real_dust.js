// DECISIVE: real (sent, confirmed) dust TransferChecked of 1e-8 AAPLx, owner-signed.
// Read actual on-chain logs. 1e-8 = $0.0000000001, negligible, our own funds.
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, createTransferCheckedInstruction } = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
const dest = new PublicKey("8jmfotEdKuhhfFvWTwnQmdAFUaQMwqTrWZ4sxnox39pv");

(async () => {
  const ix = createTransferCheckedInstruction(userAapl, dest, AAPLX, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction(); tx.add(ix);
  tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  let sig;
  try {
    sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    console.log("SENT sig:", sig);
    const conf = await c.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash, lastValidBlockHeight: (await c.getBlockHeight()) }, "confirmed");
    const status = conf.value;
    console.log("confirm status:", JSON.stringify(status));
    const txres = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    console.log("\nON-CHAIN LOGS:");
    (txres.meta.logMessages || []).forEach((l) => console.log("   " + l));
    console.log("err:", JSON.stringify(txres.meta.err));
  } catch (e) {
    console.log("send/confirm failed:", e.message.split("\n").slice(0, 12).join("\n"));
  }
})();
