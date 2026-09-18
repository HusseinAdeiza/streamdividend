// Set up local demo chain: T2022 AAPLx mint, v3 USDC mint, ATAs, token balances.
const fs = require("fs");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createMint, mintTo, getAccount, getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} = require("@solana/spl-token");

const RPC = "http://localhost:8899";
const DEMO = "/root/streamdividend-video/demo";

(async () => {
  const c = new Connection(RPC, "confirmed");
  const auth = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
  const user = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(DEMO + "/user.json", "utf8"))));

  // USDC (v3) mint — already created via CLI (address in usdc_raw.txt)
  const usdcRaw = fs.readFileSync(DEMO + "/usdc_raw.txt", "utf8");
  const usdcMint = new PublicKey(usdcRaw.match(/Address:\s+([1-9A-HJ-NP-Za-km-z]+)/)[1]);

  // AAPLx — Token-2022, 8 decimals (reuse if a prior run created one)
  let aaplMint;
  if (fs.existsSync(DEMO + "/aapl_mint.txt")) {
    aaplMint = new PublicKey(fs.readFileSync(DEMO + "/aapl_mint.txt", "utf8").trim());
    console.log("reusing AAPLx mint:", aaplMint.toBase58());
  } else {
    aaplMint = await createMint(c, auth, auth.publicKey, null, 8, Keypair.generate(), { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
    fs.writeFileSync(DEMO + "/aapl_mint.txt", aaplMint.toBase58() + "\n");
  }
  fs.writeFileSync(DEMO + "/usdc_mint.txt", usdcMint.toBase58() + "\n");
  console.log("AAPLx T2022 mint:", aaplMint.toBase58());
  console.log("USDC  v3   mint: ", usdcMint.toBase58());
  console.log("auth:", auth.publicKey.toBase58());
  console.log("user:", user.publicKey.toBase58());

  // ATAs (allowOwnerOffCurve=true everywhere for T2022 safety)
  const ataUserAapl = await getAssociatedTokenAddress(aaplMint, user.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const ataUserUsdc = await getAssociatedTokenAddress(usdcMint, user.publicKey, true);
  const ataAuthAapl = await getAssociatedTokenAddress(aaplMint, auth.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const ataAuthUsdc = await getAssociatedTokenAddress(usdcMint, auth.publicKey, true);

  const tx = new Transaction();
  const wants = [
    [ataUserAapl, user.publicKey, aaplMint, TOKEN_2022_PROGRAM_ID],
    [ataUserUsdc, user.publicKey, usdcMint, TOKEN_PROGRAM_ID],
    [ataAuthAapl, auth.publicKey, aaplMint, TOKEN_2022_PROGRAM_ID],
    [ataAuthUsdc, auth.publicKey, usdcMint, TOKEN_PROGRAM_ID],
  ];
  for (const [ata, owner, mint, tp] of wants) {
    let exists = false;
    try { await getAccount(c, ata, "confirmed", tp); exists = true; } catch { exists = false; }
    if (exists) { console.log("skip existing ATA", ata.toBase58().slice(0, 8)); continue; }
    tx.add(createAssociatedTokenAccountInstruction(auth.publicKey, ata, owner, mint, tp));
  }
  if (tx.instructions.length > 0) {
    const s2 = await sendAndConfirmTransaction(c, tx, [auth]);
    console.log("ATAs created:", s2.slice(0, 16));
  } else {
    console.log("all ATAs already exist");
  }

  // user holds 100 AAPLx; auth holds 27 USDC (dividend to be triggered)
  const s3a = await mintTo(c, auth, aaplMint, ataUserAapl, auth.publicKey, 100 * 1e8, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const s3b = await mintTo(c, auth, usdcMint, ataAuthUsdc, auth.publicKey, 27 * 1e6);
  console.log("minted tokens:", s3a.slice(0, 16));

  for (const [label, mint, owner, tp] of [
    ["user AAPLx", aaplMint, user.publicKey, TOKEN_2022_PROGRAM_ID],
    ["user USDC ", usdcMint, user.publicKey, TOKEN_PROGRAM_ID],
    ["auth AAPLx", aaplMint, auth.publicKey, TOKEN_2022_PROGRAM_ID],
    ["auth USDC ", usdcMint, auth.publicKey, TOKEN_PROGRAM_ID],
  ]) {
    const ata = await getAssociatedTokenAddress(mint, owner, true, tp);
    const acc = await getAccount(c, ata, "confirmed", tp);
    console.log(label, "=", acc.uiAmountString);
  }

  fs.writeFileSync(DEMO + "/chain.env", JSON.stringify({
    RPC,
    AAPL_MINT: aaplMint.toBase58(),
    USDC_MINT: usdcMint.toBase58(),
    AUTH: auth.publicKey.toBase58(),
    USER: user.publicKey.toBase58(),
    ataUserAapl: ataUserAapl.toBase58(),
    ataUserUsdc: ataUserUsdc.toBase58(),
    ataAuthAapl: ataAuthAapl.toBase58(),
    ataAuthUsdc: ataAuthUsdc.toBase58(),
  }, null, 2));
  console.log("wrote", DEMO + "/chain.env");
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
