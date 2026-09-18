const { Connection, PublicKey } = require("@solana/web3.js");
const conn = new Connection("https://api.mainnet-beta.solana.com","confirmed");
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function get(fn){ for(let a=0;a<8;a++){ try{ return await fn(); }catch(e){ await sleep(1600*(a+1)); } } return null; }
const WALLET = new PublicKey("4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi");
(async () => {
  const [wallet, oldBuf, newBuf, newBufZ] = await Promise.all([
    get(()=>conn.getBalance(WALLET)),
    get(()=>conn.getMinimumBalanceForRentExemption(37 + 304376)), // old fixed .so
    get(()=>conn.getMinimumBalanceForRentExemption(37 + 259856)), // compressed .so
    get(()=>conn.getMinimumBalanceForRentExemption(305429)),
  ]);
  const W=wallet/1e9, O=oldBuf/1e9, N=newBuf/1e9;
  console.log("wallet:           ", W.toFixed(9));
  console.log("buffer rent OLD (304,413B): ", O.toFixed(9), "SOL  -> top-up was ", (O-W).toFixed(6));
  console.log("buffer rent NEW (259,893B): ", N.toFixed(9), "SOL  -> top-up now ", (N-W).toFixed(6));
  console.log("");
  const fees = 0.000115;
  console.log("FUND TO SEND (compressed build): ", (N - W).toFixed(6), "+ fees -> send ", (N - W + 0.0003).toFixed(4), "SOL");
  console.log("savings vs 1.144:                ", (1.144 - (N - W + 0.0003)).toFixed(4), "SOL less to send now");
  console.log("");
  const after = W + (N-W+0.0003) - fees; // round-trip: net = start + topup - fees
  console.log("wallet after upgrade (1:1 buffer refund): ", after.toFixed(6), "SOL");
  console.log("runway: can fund ANOTHER upgrade from same wallet?", after >= N + fees ? "YES" : "NO");
})();
