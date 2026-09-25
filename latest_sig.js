// Print the newest signature for the demo wallet with blockTime >= arg[0] (epoch s).
const fs = require("fs");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
(async () => {
  const since = Number(process.argv[2] || 0);
  const AUTH = new PublicKey("4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi");
  const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const txs = await c.getSignaturesForAddress(AUTH, { limit: 5 }, "confirmed");
  for (const t of txs) {
    if (t.blockTime && t.blockTime >= since && !t.err) {
      console.log("SIG:" + t.signature);
      return;
    }
  }
  console.log("SIG:none");
})();
