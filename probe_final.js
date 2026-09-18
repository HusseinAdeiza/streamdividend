// DEFINITIVE: real spl-token TransferChecked, simulate 1e-8 owner-signed move of real AAPLx.
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} = require("@solana/spl-token");
const fs = require("fs");

const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
const throwawayOwner = new PublicKey("8jmfotEdKuhhfFvWTwnQmdAFUaQMwqTrWZ4sxnox39pv");
const dest = throwawayOwner; // already an on-curve AAPLx ATA (created in probe_aaplx4)

(async () => {
  const ix = createTransferCheckedInstruction(
    userAapl,
    dest,
    AAPLX,
    AUTH.publicKey,
    1,
    8,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  const bh = (await c.getLatestBlockhash("confirmed")).blockhash;
  const tx = new Transaction();
  tx.add(ix); tx.recentBlockhash = bh; tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  const sim = await c.simulateTransaction(tx);
  console.log("[OWNER TransferChecked real AAPLx — correct encoding]");
  console.log("  err:", JSON.stringify(sim.value.err));
  (sim.value.logMessages || []).slice(0, 12).forEach((l) => console.log("   " + l));
  console.log(sim.value.err === null
    ? "\nVERDICT: owner CAN move real AAPLx via TransferChecked -> program fix = switch to TransferChecked."
    : "\nVERDICT: owner CANNOT move real AAPLx (permanentDelegate) -> owner deposit of real AAPLx is impossible.");
})();
