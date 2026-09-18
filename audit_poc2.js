// SECURITY AUDIT PoC (part 2) — clean vaults, EXACT live binary sha 83e25a99
// F-2 (LOW/liveness): trigger a dividend whose per_share truncates to 0 -> USDC enters the
//     pool but NO holder can ever claim it; no rescue/withdraw-authority ix exists.
// H-A (info): rounding drift — 1:1 vs pro-rata share math on deposit/withdraw.
// H-B (info): dust-DoS — tiny position, can it withdraw?
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");
const { createMint, getAccount, createAssociatedTokenAccount, mintTo } = require("@solana/spl-token");
const { AnchorProvider, Wallet, Program, BN } = require("@coral-xyz/anchor");
const fs = require("fs");

const idl = JSON.parse(fs.readFileSync("/root/streamdividend/target/idl/streamdividend.json"));
const PROGRAM = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
const V3 = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYS = SystemProgram.programId;

(async () => {
  const owner = Keypair.generate();
  const conn = new Connection("http://localhost:8899", "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(owner.publicKey, 60 * 1e9), "confirmed");
  const P = owner.publicKey;
  const provider = new AnchorProvider(conn, new Wallet(owner), { commitment: "confirmed" });
  const program = new Program(idl, PROGRAM, provider);
  const D = (n, d) => new BN(Math.round(n * 10 ** d));
  const bal = async (a) => (await getAccount(conn, a)).amount;
  const ataOff = (mint, o) => createAssociatedTokenAccount(conn, owner, mint, o, undefined, undefined, undefined, true);
  const progOf = (k) => new Program(idl, PROGRAM, new AnchorProvider(conn, new Wallet(k), { commitment: "confirmed" }));
  const fund = async (k, lam = 5e9) => provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: P, toPubkey: k.publicKey, lamports: lam })));

  const xMint = await createMint(conn, owner, P, null, 8);
  const uMint = await createMint(conn, owner, P, null, 6);

  // ---- big clean vault: 20,000 xStock (2e12 base) => total_shares=2e12 > 1e12 ----
  const ca = Keypair.generate(); await fund(ca);
  const caVault = PublicKey.findProgramAddressSync([Buffer.from("vault"), ca.publicKey.toBytes()], PROGRAM)[0];
  const caVaultX = await ataOff(xMint, caVault);
  const caVaultU = await ataOff(uMint, caVault);
  const caX = await createAssociatedTokenAccount(conn, owner, xMint, ca.publicKey);
  const caU = await createAssociatedTokenAccount(conn, owner, uMint, ca.publicKey);
  const caAccs = { vault: caVault, xstockMint: xMint, dividendMint: uMint, systemProgram: SYS };
  const pCa = progOf(ca);
  const uS = (u) => PublicKey.findProgramAddressSync([Buffer.from("user"), caVault.toBytes(), u.toBytes()], PROGRAM)[0];
  await program.methods.initialize().accounts(caAccs).rpc();

  const dep = (prog, k, from, amt) => prog.methods.deposit(amt).accounts({ ...caAccs, user: k.publicKey, userState: uS(k.publicKey), userXstock: from, vaultXstock: caVaultX, tokenProgram: V3 }).rpc();
  const wd = (prog, k, toX, toU, shares) => prog.methods.withdraw(shares).accounts({ ...caAccs, user: k.publicKey, userState: uS(k.publicKey), userXstock: toX, vaultXstock: caVaultX, userDividend: toU, vaultDividend: caVaultU, tokenProgram: V3, usdcTokenProgram: V3 }).rpc();
  const trigger = (amt) => program.methods.triggerDividend(amt).accounts({ ...caAccs, authority: ca.publicKey, adminDividend: caU, vaultDividend: caVaultU, tokenProgram: V3 }).rpc();
  const claim = (prog, k, toU) => prog.methods.claimDividend().accounts({ ...caAccs, user: k.publicKey, userState: uS(k.publicKey), userDividend: toU, vaultDividend: caVaultU, tokenProgram: V3 }).rpc();

  await mintTo(conn, owner, xMint, caX, P, D(20000, 8));
  await dep(pCa, ca, caX, D(20000, 8));
  let cv = await program.account.vault.fetch(caVault);
  console.log(`big vault: total_xstock=${cv.totalXstock.toString()} total_shares=${cv.totalShares.toString()}`);

  // ================= F-2: dust trigger, per_share truncates to 0 =================
  console.log("\n=== F-2: dust trigger (1 base USDC into a 2e12-share vault) ===");
  await mintTo(conn, owner, uMint, caU, P, D(5, 6));
  const pB = await bal(caVaultU);
  await trigger(new BN(1)); // 1 base = $0.000001
  const pA = await bal(caVaultU);
  cv = await program.account.vault.fetch(caVault);
  console.log(`pool +${Number((BigInt(pA.toString()) - BigInt(pB.toString())).toString())} base; dividends_per_share=${cv.dividendsPerShare.toString()} (0 => nothing accrued)`);
  const caUB = await bal(caU);
  const cr = await claim(pCa, ca, caU).then(() => "claimed").catch(e => String(e.message || e).match(/Error Message: [^"]*/)?.[0] || "err");
  const caUA = await bal(caU);
  const pFinal = await bal(caVaultU);
  console.log(`claim=${cr} (+${Number((BigInt(caUA.toString()) - BigInt(caUB.toString())).toString())} base); pool still holds ${Number(pFinal.toString())} base — STUCK, no rescue ix`);

  // ================= H-A: rounding drift =================
  console.log("\n=== H-A: rounding drift (10 xStock round-trip, 1:1 vault) ===");
  const d2 = Keypair.generate(); await fund(d2);
  const d2X = await createAssociatedTokenAccount(conn, owner, xMint, d2.publicKey);
  const d2U = await createAssociatedTokenAccount(conn, owner, uMint, d2.publicKey);
  const pD2 = progOf(d2);
  await mintTo(conn, owner, xMint, d2X, P, D(10, 8));
  await dep(pD2, d2, d2X, D(10, 8));
  const s2 = (await program.account.userState.fetch(uS(d2.publicKey))).shares;
  const dB = await bal(d2X);
  await wd(pD2, d2, d2X, d2U, s2);
  const dA = BigInt((await bal(d2X)).toString()) - BigInt(dB.toString());
  console.log(`deposited 1e9 units, withdrew ${dA.toString()} units (${dA > 10n ** 9n ? "OVERPAID (drift)" : dA < 10n ** 9n ? "underpaid (vault retains dust)" : "exact"})`);

  // ================= H-B: dust-DoS =================
  console.log("\n=== H-B: dust-DoS (1 base xStock into 2e12-share vault) ===");
  const d3 = Keypair.generate(); await fund(d3);
  const d3X = await createAssociatedTokenAccount(conn, owner, xMint, d3.publicKey);
  const d3U = await createAssociatedTokenAccount(conn, owner, uMint, d3.publicKey);
  const pD3 = progOf(d3);
  await mintTo(conn, owner, xMint, d3X, P, 1n);
  const dp = await dep(pD3, d3, d3X, new BN(1)).then(() => "ok").catch(e => String(e.message || e).match(/Error Message: [^"]*/)?.[0] || "err");
  console.log(`deposit 1 base: ${dp}`);
  if (dp === "ok") {
    const s3 = (await program.account.userState.fetch(uS(d3.publicKey))).shares;
    console.log(`shares minted: ${s3.toString()}`);
    const w3 = await wd(pD3, d3, d3X, d3U, s3).then(() => "ok").catch(e => String(e.message || e).match(/Error Message: [^"]*/)?.[0] || "err");
    console.log(`full-withdraw(${s3.toString()}): ${w3} (ZeroAmount => dust-DoS: position locked forever)`);
  }

  console.log("\n=== done ===");
  process.exit(0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
