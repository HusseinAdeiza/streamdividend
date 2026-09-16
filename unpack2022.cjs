const { Connection, PublicKey } = require("@solana/web3.js");
const { unpackMint, TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token");
(async () => {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const mint = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
  const info = await conn.getAccountInfo(mint);
  if (!info) { console.log("NOT FOUND"); return; }
  console.log("owner:", info.owner.toBase58(), info.owner.equals(TOKEN_2022_PROGRAM_ID)?"== TOKEN-2022":"(not 2022)");
  const m = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
  console.log("decimals:", m.decimals, " supply:", m.supply.toString(), " isInit:", m.isInitialized);
  const ext = m.extensions || [];
  console.log("num extensions:", ext.length);
  for (const e of ext) {
    console.log("  ext type:", e.extension, e.type||"", (e.state||{}).hookProgram? " hookProgram="+(e.state.hookProgram.toBase58()||e.state.hookProgram):"");
  }
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
