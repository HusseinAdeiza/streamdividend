// Exact funding math for upgrading the program (same program ID).
const { Connection, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
(async () => {
  const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const wallet = new PublicKey(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8")).map(Number));
  const prog = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
  const loader = new PublicKey("BPFLoaderUpgradeab1e1111111111111111111");
  const [pd] = PublicKey.findProgramAddressSync([Buffer.from(prog.toBytes()), Buffer.from("ProgramData")], loader);
  const pdAcc = await c.getAccountInfo(pd);
  const walletBal = await c.getBalance(wallet);
  const newSo = fs.statSync("target/deploy/streamdividend.so").size;
  const LAMPORTS_PER_BYTE = 1314;
  const HEADER = 8 + 32 + 32 + 4; // slot(4?)+slotPub(32)+authority(32)+... use standard: 44 + data
  // ProgramData rent = 44 (fixed header) + data_len, minus 8 (loader discriminator overlap) => standard formula:
  const newRent = (44 + newSo) * LAMPORTS_PER_BYTE;
  const oldRent = (44 + 305384) * LAMPORTS_PER_BYTE;
  const sol = (l) => l / 1e9;
  console.log("wallet SOL now        :", sol(walletBal).toFixed(6));
  console.log("ProgramData SOL held  :", sol(pdAcc.data.length) + " (bytes) -> balance " + sol((await c.getBalance(pd))).toFixed(6));
  console.log("new .so               :", newSo, "bytes");
  console.log("new ProgramData rent  :", sol(newRent).toFixed(6), "SOL");
  console.log("ProgramData balance   :", sol((await c.getBalance(pd))).toFixed(6), "SOL");
  const topUp = Math.max(0, newRent - (await c.getBalance(pd)));
  const bufferRent = newRent; // temporary buffer for the deploy
  const fees = 20000 * 3;
  const peak = bufferRent + topUp + fees;
  console.log("\n--- funding needed (peak, buffer is returned after) ---");
  console.log("buffer (temp)         :", sol(bufferRent).toFixed(6), "SOL");
  console.log("ProgramData top-up    :", sol(topUp).toFixed(6), "SOL (permanent)");
  console.log("fees (~)              :", sol(fees).toFixed(6), "SOL");
  console.log("PEAK NEEDED           :", sol(peak).toFixed(6), "SOL  = $", (sol(peak) * 99.5).toFixed(2));
  console.log("have                  :", sol(walletBal).toFixed(6), "SOL");
  console.log("SHORTFALL             :", sol(peak - walletBal).toFixed(6), "SOL  = $", (sol(peak - walletBal) * 99.5).toFixed(2));
})();
