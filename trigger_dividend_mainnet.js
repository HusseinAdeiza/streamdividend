// Admin action (authority only): trigger the first real dividend on MAINNET.
// Funds the vault's USDC pool with our 0.796664 USDC and sets
// dividends-per-share so it displays as $0.27 per AAPLx share
// (Apple's current real quarterly dividend).
//
// per-share accumulator math:
//   dps = amount * 1e12 / total_shares            (program invariant)
//   display = dps / 1e10  USDC per share
//   => dps  = 0.27 * 1e10 = 2.7e9
//   => amount = dps * total_shares / 1e12
//      = 2.7e9 * 1191443 / 1e12 = 3217 base = 0.003217 USDC
//      (= $0.27 * 0.01191443 AAPLx held — Apple's real rate on our position)
const fs = require("fs");
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { AnchorProvider, Program } = require("@coral-xyz/anchor");

const RPC = "https://api.mainnet-beta.solana.com";
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const idl = JSON.parse(fs.readFileSync("/root/streamdividend-app/src/lib/idl.json", "utf8"));
const PROGRAM_ID = "LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA";
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

(async () => {
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, {
    publicKey: AUTH.publicKey,
    signTransaction: async (tx) => { tx.feePayer = AUTH.publicKey; tx.sign(AUTH); return tx; },
    signAllTransactions: async (txs) => { txs.forEach(t => { t.feePayer = AUTH.publicKey; t.sign(AUTH); }); return txs; },
  }, { preflightCommitment: "confirmed", commitment: "confirmed" });
  const program = new Program(idl, PROGRAM_ID, provider);

  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), AUTH.publicKey.toBuffer()], program.programId);
  console.log("vault:", vault.toBase58());

  // read vault to get totalShares
  const info = await connection.getAccountInfo(vault, "confirmed");
  if (!info) throw new Error("vault not found");
  const v = program.coder.accounts.decode("Vault", info.data);
  const totalShares = Number(v.totalShares.toString());
  console.log("totalShares (base):", totalShares, "=", totalShares / 1e8, "shares");
  if (totalShares === 0) { console.log("VAULT EMPTY — deposit first!"); process.exit(1); }

  const dps = 2_700_000_000n; // 2.7e9 => displays $0.27
  const amountBase = Number((dps * BigInt(totalShares)) / 1_000_000_000_000n);
  console.log("triggering USDC amount:", (amountBase / 1e6).toFixed(6));

  // vault USDC ATA + authority USDC ATA
  const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
  const vaultUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, vault, true, TOKEN_PROG);
  const authUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, AUTH.publicKey);
  console.log("vault USDC ATA:", vaultUsdcAta.toBase58());
  console.log("auth  USDC ATA:", authUsdcAta.toBase58());

  const tx = await program.methods
    .triggerDividend(amountBase)
    .accounts({
      vault,
      authority: AUTH.publicKey,
      adminDividend: authUsdcAta,
      vaultDividend: vaultUsdcAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROG,
    })
    .transaction();
  tx.feePayer = AUTH.publicKey;
  tx.sign(AUTH);
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  console.log("sig:", sig);
  const conf = await connection.confirmTransaction(sig, "confirmed");
  if (conf.value.err) { console.error("TX ERR:", JSON.stringify(conf.value.err)); process.exit(1); }
  console.log("DIVIDEND TRIGGERED ✓  (Apple's real $0.27/share, mainnet)");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
