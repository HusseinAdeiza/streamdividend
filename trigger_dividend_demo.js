// Real dividend trigger (authority, mainnet) — Apple's real $0.27/share rate.
// Mirrors trigger_dividend_mainnet.js (proven pattern), amount computed live.
const fs = require("fs");
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { AnchorProvider, Program, BN } = require("@coral-xyz/anchor");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

const RPC = "https://api.mainnet-beta.solana.com";
const RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com", "https://rpc.ankr.com/solana"];
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const idl = JSON.parse(fs.readFileSync("/root/streamdividend-app/src/lib/idl.json", "utf8"));
const PROGRAM_ID = "LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA";
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const DPS_INC = 2_700_000_000n; // +$0.27 per AAPLx share (Apple's real quarterly rate)

(async () => {
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, {
    publicKey: AUTH.publicKey,
    signTransaction: async (tx) => { tx.feePayer = AUTH.publicKey; tx.sign(AUTH); return tx; },
    signAllTransactions: async (txs) => { txs.forEach(t => { t.feePayer = AUTH.publicKey; t.sign(AUTH); }); return tx; },
  }, { preflightCommitment: "confirmed", commitment: "confirmed" });
  const program = new Program(idl, PROGRAM_ID, provider);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), AUTH.publicKey.toBuffer()], program.programId);
  const info = await connection.getAccountInfo(vault, "confirmed");
  const v = program.coder.accounts.decode("Vault", info.data);
  const totalShares = Number(v.totalShares.toString());
  const amountBase = Number((DPS_INC * BigInt(totalShares)) / 1_000_000_000_000n);
  console.log("triggering USDC amount:", (amountBase / 1e6).toFixed(6), "(shares", totalShares, ")");

  const vaultUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, vault, true, TOKEN_PROG);
  const authUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, AUTH.publicKey);

  const tx = await program.methods
    .triggerDividend(new BN(amountBase))
    .accounts({
      vault,
      authority: AUTH.publicKey,
      adminDividend: authUsdcAta,
      vaultDividend: vaultUsdcAta,
      dividendMint: USDC_MINT,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROG,
    })
    .transaction();
  let bh = null;
  for (const url of RPCS) {
    try {
      const c = new Connection(url, "confirmed");
      const r = await c.getLatestBlockhash("confirmed");
      const hash = r && (r.blockhash || (r.value && r.value.blockhash));
      if (hash) { bh = hash; break; }
    } catch (e) { console.log("blockhash fail", url, e.message.slice(0, 40)); }
  }
  if (!bh) throw new Error("no blockhash from any RPC");
  tx.recentBlockhash = bh;
  tx.feePayer = AUTH.publicKey;
  tx.sign(AUTH);
  const wire = tx.serialize();
  let sig = null, err = null;
  for (const url of RPCS) {
    try {
      const c = new Connection(url, "confirmed");
      sig = await c.sendRawTransaction(wire, { maxRetries: 3 });
      break;
    } catch (e) { err = e; }
  }
  if (!sig) throw err || new Error("send failed on all RPCs");
  console.log("TRIGGER_SIG:" + sig);
  const conf = await new Connection(RPCS[0], "confirmed").confirmTransaction(sig, "confirmed");
  const cerr = conf && (conf.err || (conf.value && conf.value.err));
  if (cerr) { console.error("TX ERR:", JSON.stringify(cerr)); process.exit(1); }
  console.log("DIVIDEND TRIGGERED OK");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
