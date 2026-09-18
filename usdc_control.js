// CONTROL: USDC v3 self-transfer (no extensions). Proves harness+encoding are right.
// If USDC succeeds but real AAPLx fails => the AAPLx failure is mint-extension-specific.
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, createTransferCheckedInstruction } = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const userUsdc = new PublicKey("AX3me5NR7ZL3kHB1Rcase5Z4yVReLqUgZdh6z4JW9iAA"); // holds 0.796664 USDC

(async () => {
  const ix = createTransferCheckedInstruction(userUsdc, userUsdc, USDC, AUTH.publicKey, 1, 6, undefined, TOKEN_PROGRAM_ID);
  const tx = new Transaction(); tx.add(ix);
  tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  try {
    const s = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    await c.confirmTransaction({ signature: s, blockhash: tx.recentBlockhash, lastValidBlockHeight: await c.getBlockHeight() }, "confirmed");
    console.log("USDC v3 self-transfer: SUCCEEDED (sig " + s.slice(0, 16) + "...)");
    console.log("=> harness/encoding correct. Real AAPLx failure is mint-extension-specific (permanentDelegate).");
  } catch (e) {
    console.log("USDC v3 self-transfer: FAILED (unexpected):", e.message.split("\n").slice(0, 12).join("\n"));
  }
})();
