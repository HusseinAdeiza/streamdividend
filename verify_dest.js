// Verify the throwaway dest is a valid AAPLx token account (isolate the probe artifact).
const { Connection, PublicKey } = require("@solana/web3.js");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const dest = new PublicKey("8jmfotEdKuhhfFvWTwnQmdAFUaQMwqTrWZ4sxnox39pv");
const userAapl = new PublicKey("2MwkofYHVxDMZ3hK5iHnz2yxBUmqF4AAXq9oV6oRQac1");
(async () => {
  for (const [name, pk] of [["throwaway dest", dest], ["user AAPLx ATA", userAapl]]) {
    const r = await c.getParsedAccountInfo(pk);
    if (!r.value) { console.log(name, "=> NOT AN ACCOUNT"); continue; }
    const d = r.value.data.parsed.info;
    console.log(`${name}:`);
    console.log("   owner :", d.owner);
    console.log("   mint  :", d.mint, d.mint === AAPLX.toBase58() ? "(= AAPLx)" : "(!! NOT AAPLx)");
    console.log("   amount:", d.tokenAmount.uiAmountString);
    console.log("   state :", d.state);
  }
})();
