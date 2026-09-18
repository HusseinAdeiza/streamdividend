const { Connection, PublicKey, TOKEN_PROGRAM_ID } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const conn = new Connection("https://api.mainnet-beta.solana.com","confirmed");
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function get(fn){ for(let a=0;a<12;a++){ try{ return await fn(); }catch(e){ await sleep(2500*(a+1)); } } return null; }
const WALLET = new PublicKey("4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi");
const VAULT  = new PublicKey("2vsxDXuanJxrWtBzhun6yaCidHZxVNdFEobtAC3CKwM2");
(async () => {
  let aaplxMint = null;
  for (const [label, prog] of [["v3", TOKEN_PROGRAM_ID], ["2022", TOKEN_2022_PROGRAM_ID]]) {
    const accts = await get(()=>conn.getTokenAccountsByOwner(WALLET, { programId: prog }));
    if (!accts) { console.log(label, "query failed after retries"); continue; }
    console.log(`--- ${label}: ${accts.value.length} token accounts ---`);
    for (const a of accts.value) {
      const d = a.account.data;
      const mint = new PublicKey(d.slice(0,32));
      const amount = d.readBigUInt64LE(64);
      const dec = d[44];
      console.log(`  ata ${a.pubkey.toString()}  mint ${mint.toString()}  bal ${(Number(amount)/10**dec).toFixed(6)}`);
      if (mint.toString().startsWith("XsbEh")) aaplxMint = mint;
    }
    await sleep(3000);
  }
  if (!aaplxMint) { console.log("\nAAPLx mint not found in wallet token accounts"); process.exit(1); }
  const vaultAa = getAssociatedTokenAddressSync(aaplxMint, VAULT, true);
  console.log("\n=== DEPOSIT ADDRESS (send AAPLx here) ===");
  console.log("AAPLx mint:         ", aaplxMint.toString());
  console.log("VAULT deposit ATA:  ", vaultAa.toString());
})();
