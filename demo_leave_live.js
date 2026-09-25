// LEAVE-LIVE demo state for recording: deposit all AAPLx, trigger a dividend,
// and LEAVE it on-chain so the app shows a real, populated vault. Reverts on error.
const fs = require("fs");
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { AnchorProvider, Program, BN } = require("@coral-xyz/anchor");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

const RPC = "https://api.mainnet-beta.solana.com";
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const idl = JSON.parse(fs.readFileSync("/root/streamdividend-app/src/lib/idl.json", "utf8"));
const PID = "LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA";
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const T2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const TV3 = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
// known on-chain ATAs (SDK mis-derives the off-curve vault PDAs)
const vaultAaplAta = new PublicKey("E4qLqRdxvv1HTAS7gePCq9JMaNhE1BpXh3WUEJjezpsk");
const vaultUsdcAta = new PublicKey("3khNwQmsAwXaeLZe4dWGtpEfs7FjQpjEqhPjZyeGydQg");

const c = new Connection(RPC, "confirmed");
const prov = new AnchorProvider(c, {
  publicKey: AUTH.publicKey,
  signTransaction: async tx => { tx.feePayer = AUTH.publicKey; tx.sign(AUTH); return tx; },
  signAllTransactions: async txs => { txs.forEach(t => { t.feePayer = AUTH.publicKey; t.sign(AUTH); }); return txs; },
}, { preflightCommitment: "confirmed", commitment: "confirmed" });
const p = new Program(idl, PID, prov);

const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), AUTH.publicKey.toBuffer()], new PublicKey(PID));
const [us] = PublicKey.findProgramAddressSync([Buffer.from("user"), vault.toBuffer(), AUTH.publicKey.toBuffer()], new PublicKey(PID));
const uAapl = getAssociatedTokenAddressSync(AAPLX, AUTH.publicKey, true, T2022);
const uUsdc = getAssociatedTokenAddressSync(USDC, AUTH.publicKey);

async function send(tx, label) {
  const bh = (await c.getLatestBlockhash()).blockhash;
  tx.recentBlockhash = bh; tx.feePayer = AUTH.publicKey; tx.sign(AUTH);
  const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const cf = await c.confirmTransaction(sig, "confirmed");
  if (cf.value.err) { console.error(label, "ERR", JSON.stringify(cf.value.err)); process.exit(1); }
  console.log(label, "confirmed ✓", "\n  https://solscan.io/tx/" + sig);
  return sig;
}
async function bal(a) { return (await c.getTokenAccountBalance(a, "confirmed")).value; }
async function vaultState() {
  const acc = await c.getAccountInfo(vault, "confirmed");
  return p.coder.accounts.decode("Vault", acc.data);
}

(async () => {
  const [dep] = [await bal(uAapl)];
  console.log(`[deposit] wallet AAPLx: ${dep.uiAmountString} (${dep.amount} base)`);
  await send((await p.methods.deposit(new BN(dep.amount)).accounts({
    user: AUTH.publicKey, vault, userState: us, userXstock: uAapl, vaultXstock: vaultAaplAta,
    xstockMint: AAPLX, systemProgram: SystemProgram.programId, tokenProgram: T2022,
  }).transaction()), "deposit");

  let v = await vaultState();
  const totalShares = Number(v.totalShares.toString());
  const dps = 2_700_000_000n; // $0.27/share
  const amt = Number((dps * BigInt(totalShares)) / 1_000_000_000_000n);
  console.log(`[trigger] ${(amt / 1e6).toFixed(6)} USDC on ${totalShares / 1e8} AAPLx`);
  await send((await p.methods.triggerDividend(new BN(amt)).accounts({
    vault, authority: AUTH.publicKey, adminDividend: uUsdc, vaultDividend: vaultUsdcAta,
    dividendMint: USDC, systemProgram: SystemProgram.programId, tokenProgram: TV3,
  }).transaction()), "trigger");

  v = await vaultState();
  console.log("\n=== LIVE VAULT STATE (what the app shows) ===");
  console.log("  AAPLx in vault :", (Number(await (await bal(vaultAaplAta)).amount) / 1e8).toFixed(8));
  console.log("  div pool       :", (Number(v.dividendPool.toString()) / 1e6).toFixed(6), "USDC");
  console.log("  $/share        :", (Number(v.dividendsPerShare.toString()) / 1e10).toFixed(4));
  console.log("  distributed    :", (Number(v.totalDividendsDistributed.toString()) / 1e6).toFixed(6), "USDC");
  console.log("  wallet AAPLx   :", (await bal(uAapl)).uiAmountString);
  console.log("  wallet USDC    :", (await bal(uUsdc)).uiAmountString);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });