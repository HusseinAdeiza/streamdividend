// CLEAN owner-transfer test: fresh throwaway owner -> its CANONICAL AAPLx ATA.
// If permanentDelegate blocks owner, this fails with a delegate/authority error.
// If it's just ATA-canonicity, this SUCCEEDS (owner can move real AAPLx).
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

(async () => {
  const owner = Keypair.generate(); // fresh throwaway wallet
  const destAta = getAssociatedTokenAddressSync(AAPLX, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  console.log("throwaway owner:", owner.publicKey.toBase58());
  console.log("canonical dest ATA:", destAta.toBase58());

  // 1) fund + create canonical ATA (payer AUTH)
  const rent = await c.getMinimumBalanceForRentExemption(165);
  const tx1 = new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: AUTH.publicKey, toPubkey: owner.publicKey, lamports: rent }))
    .add(createAssociatedTokenAccountIdempotentInstruction(AUTH.publicKey, destAta, owner.publicKey, AAPLX, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  tx1.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx1.feePayer = AUTH.publicKey; tx1.sign(AUTH);
  const s1 = await c.sendRawTransaction(tx1.serialize(), { maxRetries: 3 });
  await c.confirmTransaction({ signature: s1, blockhash: tx1.recentBlockhash, lastValidBlockHeight: await c.getBlockHeight() }, "confirmed");
  console.log("ATA created:", s1.slice(0, 20) + "...");

  // 2) THE TEST: owner (AUTH) signs TransferChecked 1e-8 -> canonical destAta
  const ix = createTransferCheckedInstruction(userAapl, destAta, AAPLX, AUTH.publicKey, 1, 8, undefined, TOKEN_2022_PROGRAM_ID);
  const tx2 = new Transaction(); tx2.add(ix);
  tx2.recentBlockhash = (await c.getLatestBlockhash("confirmed")).blockhash;
  tx2.feePayer = AUTH.publicKey; tx2.sign(AUTH);
  try {
    const s2 = await c.sendRawTransaction(tx2.serialize(), { maxRetries: 3 });
    await c.confirmTransaction({ signature: s2, blockhash: tx2.recentBlockhash, lastValidBlockHeight: await c.getBlockHeight() }, "confirmed");
    const t2 = await c.getTransaction(s2, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    console.log("\n=== OWNER TransferChecked of real AAPLx: SUCCEEDED ===");
    console.log("sig:", s2);
    (t2.meta.logMessages || []).slice(0, 8).forEach((l) => console.log("   " + l));
    console.log("\nVERDICT: permanentDelegate does NOT block the owner. Owner CAN move real AAPLx.");
  } catch (e) {
    console.log("\n=== OWNER TransferChecked of real AAPLx: FAILED ===");
    console.log(e.message.split("\n").slice(0, 16).join("\n"));
  }
})();
