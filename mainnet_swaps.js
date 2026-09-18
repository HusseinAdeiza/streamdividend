// Mainnet demo: swap SOL -> AAPLx into the authority wallet's ATA, and SOL -> USDC.
// Uses Jupiter swap API (quote + swap). Signs with the authority keypair.
// Usage: node mainnet_swaps.js  (reads wallet from ~/.config/solana/id.json)
const fs = require("fs");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");

const WALLET = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");

const SOLM = "So11111111111111111111111111111111111111112";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function jup(path) {
  const r = await fetch("https://lite-api.jup.ag" + path, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`jup ${path} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function swap(outMint, amountLamports, label) {
  console.log(`\n== ${label}: ${amountLamports / 1e9} SOL -> ${outMint.slice(0, 8)}…`);
  const quote = await jup(`/swap/v1/quote?inputMint=${SOLM}&outputMint=${outMint}&amount=${amountLamports}&slippageBps=50`);
  const outAmt = Number(quote.outAmount);
  console.log(`   quote: out ${outAmt} (dec ${quote.outAmountDecimals}) ~ $${(outAmt / 10 ** quote.outAmountDecimals).toFixed(3)}`);
  const swapResp = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: WALLET.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 5_000_000, priorityLevel: "high" } },
    }),
  });
  if (!swapResp.ok) throw new Error(`jup swap -> ${swapResp.status}: ${(await swapResp.text()).slice(0, 300)}`);
  const { swapTransaction } = await swapResp.json();
  const tx = await (async () => {
    const buf = Buffer.from(swapTransaction, "base64");
    const { VersionedTransaction } = require("@solana/web3.js");
    return VersionedTransaction.deserialize(buf);
  })();
  tx.sign([WALLET]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  console.log("   sig:", sig);
  const conf = await connection.confirmTransaction({ signature: sig, blockhash: tx.message.recentBlockhash, nonceBlockhash: tx.message.recentBlockhash }, "confirmed");
  if (conf.value.err) throw new Error("confirm err: " + JSON.stringify(conf.value.err));
  console.log("   confirmed ✓");
  return sig;
}

(async () => {
  const before = await connection.getBalance(WALLET.publicKey);
  console.log("balance before:", (before / 1e9).toFixed(6), "SOL");
  // keep ~0.006 SOL for fees/buffer
  const swapAapl = 40_000_000;   // 0.04 SOL -> ~0.0119 AAPLx
  const swapUsdc = 8_000_000;    // 0.008 SOL -> ~0.79 USDC
  await swap(AAPLX, swapAapl, "SOL->AAPLx");
  await swap(USDC, swapUsdc, "SOL->USDC");
  const after = await connection.getBalance(WALLET.publicKey);
  console.log("balance after:", (after / 1e9).toFixed(6), "SOL");
  console.log("DONE");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
