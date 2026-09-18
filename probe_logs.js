// Re-probe with correct logs field (web3 1.99 uses .logs).
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, createTransferCheckedInstruction } = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
const dest = new PublicKey("8jmfotEdKuhhfFvWTwnQmdAFUaQMwqTrWZ4sxnox39pv");

(async () => {
  // 1) owner -> external dest
  let ix = createTransferCheckedInstruction(userAapl, dest, AAPLX, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID);
  let tx = new Transaction(); tx.add(ix);
  tx.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  let sim = await c.simulateTransaction(tx);
  console.log("[owner -> dest] err:", JSON.stringify(sim.value.err));
  console.log("  keys check — tx account keys:", tx.message.staticAccountKeys.map(k => k.toBase58()).join(", "));
  (sim.value.logs || []).forEach((l) => console.log("   " + l));

  // 2) control: same tx shape but USDC (v3, no extensions) userUsdc -> dest-usdc-ata
  //    (dest USDC ATA = AX3me5...) — expect SUCCESS to prove the harness works.
  const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const userUsdc = new PublicKey("AX3me5NR7ZL3kHB1Rcase5Z4yVReLqUgZdh6z4JW9iAA");
  const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
  const usdcDest = getAssociatedTokenAddressSync(USDC, PublicKey.findProgramAddressSync([Buffer.from(userAapl.toBytes()), Buffer.from("usdcdest"), Buffer.from(USDC.toBytes())], TOKEN_2022_PROGRAM_ID)[0], false);
  // simpler: just use a fresh throwaway owner for the USDC dest ATA address (need it funded? no — simulate only checks owner validity? actually dest must exist for real, but for SIMULATION of USDC we can check whether sim passes account checks)
  // Use the user's OWN usdc ata as dest (self-transfer of USDC) — dest must exist: it does.
  let ix2 = createTransferCheckedInstruction(userUsdc, userUsdc, USDC, AUTH.publicKey, 1, 6, undefined, require("@solana/spl-token").TOKEN_PROGRAM_ID);
  let tx2 = new Transaction(); tx2.add(ix2);
  tx2.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx2.feePayer = AUTH.publicKey; tx2.sign(AUTH);
  let sim2 = await c.simulateTransaction(tx2);
  console.log("\n[USDC self-transfer control] err:", JSON.stringify(sim2.value.err), "success:", sim2.value.err === null);
  (sim2.value.logs || []).slice(0, 6).forEach((l) => console.log("   " + l));
})();
