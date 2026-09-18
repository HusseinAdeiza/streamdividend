const { Connection, PublicKey } = require("@solana/web3.js");
const conn = new Connection("https://api.mainnet-beta.solana.com","confirmed");
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function get(fn){ for(let a=0;a<8;a++){ try{ return await fn(); }catch(e){ await sleep(1600*(a+1)); } } return null; }
const WALLET = new PublicKey("4KTQiDUyvnkWyK7Vs4hnAp54UZecu3Vo1jku3JQ6kHWi");
const PD     = new PublicKey("3EVmVdXM8WoMZG2jd527Wn4Vhmm222RXLTfnRthszCYw");
const NEW_ELF = 304376;            // fixed .so bytes
const BUF_META = 37;               // size_of_buffer_metadata() (loader source)
const NEW_BUF_BYTES = NEW_ELF + BUF_META; // 304,413
const OLD_PD_BYTES = 305429;       // current ProgramData size

(async () => {
  const [wallet, pd, bufRent, pdRent] = await Promise.all([
    get(()=>conn.getBalance(WALLET)),
    get(()=>conn.getBalance(PD)),
    get(()=>conn.getMinimumBalanceForRentExemption(NEW_BUF_BYTES)),
    get(()=>conn.getMinimumBalanceForRentExemption(OLD_PD_BYTES)),
  ]);
  const W=wallet/1e9, P=pd/1e9, B=bufRent/1e9, PDCur=pdRent/1e9;

  console.log("=== LIVE (mainnet) ===");
  console.log("wallet:        ", W.toFixed(9), "SOL");
  console.log("ProgramData:   ", P.toFixed(9), "  (rent for 305,429B =", PDCur.toFixed(9), "->", Math.abs(P-PDCur)<1e-9?"MATCHES":"MISMATCH");
  console.log("new buffer:    ", B.toFixed(9), "SOL  (rent for", NEW_BUF_BYTES, "B = ELF", NEW_ELF, "+ 37 meta)");
  console.log("PD needs grow? ", OLD_PD_BYTES, ">=", NEW_BUF_BYTES, "->", OLD_PD_BYTES>=NEW_BUF_BYTES ? "NO (new build smaller)" : "YES");
  console.log("");

  // ---- Fee model (conservative) ----
  const BASE_SIG = 0.000005;         // 5000 lamports / signature
  const PRIO     = 0.00005;          // typical priority fee
  const feeFund  = BASE_SIG*2 + PRIO;   // tx1: create+fund buffer (~2 sigs)
  const feeUp    = BASE_SIG*1 + PRIO;   // tx2: upgrade (wallet = fee payer + authority, 1 sig)

  console.log("=== FUND 1.144 SOL, THEN UPGRADE (exact cash flow) ===");
  const topup = 1.144;
  const start = W + topup;
  console.log("wallet after you send 1.144:     ", start.toFixed(9));
  const afterTx1 = start - B - feeFund;
  console.log("tx1 create+fund buffer (-"+B.toFixed(9)+" -fee "+feeFund.toFixed(6)+"): ", afterTx1.toFixed(9));
  const afterUpgrade = afterTx1 - feeUp + B; // buffer fully refunded 1:1 by loader
  console.log("tx2 upgrade   (-fee "+feeUp.toFixed(6)+" +refund "+B.toFixed(9)+"):       ", afterUpgrade.toFixed(9));
  console.log("");
  console.log(">>> KEY CONSTRAINT (wallet must pay tx2 fee BEFORE the refund lands):");
  console.log("    wallet after tx1 =", afterTx1.toFixed(9), "  vs  tx2 fee", feeUp.toFixed(6), "  ->", afterTx1 >= feeUp ? "SAFE (margin "+(afterTx1-feeUp).toFixed(6)+" SOL)" : "WOULD FAIL");
  console.log("");
  console.log("wallet right after upgrade:   ", afterUpgrade.toFixed(9), "SOL");
  console.log("  (= 0.4041391 + 1.144 - "+(feeFund+feeUp).toFixed(6)+" total fees)");
  console.log("ProgramData after upgrade:    ", P.toFixed(9), "SOL (UNCHANGED - no extension)");
  console.log("net cost of the upgrade:      ", (feeFund+feeUp).toFixed(6), "SOL (fees only)");
  console.log("");

  // ---- Demo video SOL consumption ----
  console.log("=== DEMO VIDEO (mainnet, real AAPLx) SOL USE ===");
  const demoTx = 10;                 // deposit, trigger, claim, withdraw + retries/slack
  const demoFee = demoTx*(BASE_SIG*1 + PRIO);
  console.log("~", demoTx, "tx x ~"+(BASE_SIG+PRIO).toFixed(6), "fee = ~", demoFee.toFixed(6), "SOL");
  const afterDemo = afterUpgrade - demoFee;
  console.log("wallet after demo video:        ", afterDemo.toFixed(9), "SOL");
  console.log("");

  // ---- Runway: can we re-upgrade again without new money? ----
  console.log("=== RUNWAY (why no re-funding is needed) ===");
  const canReupgrade = afterDemo >= B + feeFund + feeUp;
  console.log("wallet ("+afterDemo.toFixed(4)+") >= next-upgrade requirement ("+(B+feeFund+feeUp).toFixed(4)+")?",
              canReupgrade ? "YES -> can do MORE upgrade iterations with ZERO new funding" : "NO");
  console.log("");

  console.log("=== ANSWER ===");
  console.log("1.144 covers upgrade?         ", start >= B + feeFund + feeUp ? "YES, headroom "+(start-(B+feeFund+feeUp)).toFixed(6)+" SOL" : "NO");
  console.log("more SOL for demo video?       ", afterDemo>0.3 ? "NO (fees only ~"+demoFee.toFixed(5)+", wallet stays ~"+afterDemo.toFixed(4)+")" : "CHECK");
  console.log("more SOL for extra dev/upgrades?", canReupgrade ? "NO (wallet still ~"+afterDemo.toFixed(4)+")" : "CHECK");
  console.log("");
  console.log("final wallet after everything: ~"+afterDemo.toFixed(4)+" SOL");
  console.log("untouched: USDC 0.796664, AAPLx 0.01191443 (demo assets, no SOL needed)");
})();
