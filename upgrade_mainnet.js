// Mainnet upgrade for StreamDividend (215,272 B compressed build).
// Versioned (MessageV0) txs: single SetBufferData chunks (1023 B) overflow the
// 1232-byte legacy message limit.
// Signer sets: create: [wallet] | write: [wallet, buffer] | upgrade: [wallet]
const fs = require("fs");
const crypto = require("crypto");
const { Connection, Keypair, PublicKey, SystemProgram, MessageV0, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction } = require("@solana/web3.js");
const RPC = "https://api.mainnet-beta.solana.com";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAM  = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
const PDATA    = new PublicKey("3EVmVdXM8WoMZG2jd527Wn4Vhmm222RXLTfnRthszCYw");
const RENT_SYSVAR = new PublicKey("SysvarRent111111111111111111111111111111111");
const conn = new Connection(RPC, "confirmed");
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function retry(fn, n=6) { for(let a=0;a<n;a++){ try{ return await fn(); }catch(e){ await sleep(2000*(a+1)); } } throw new Error("retries exhausted: " + (e&&e.message)); }

function buildVtx(ixs, signers, bh) {
  // this web3.js fork auto-derives static keys + header from instructions
  const msg = MessageV0.compile({
    instructions: ixs,
    payerKey: signers[0].publicKey,
    recentBlockhash: bh.blockhash,
  });
  const vtx = new VersionedTransaction(msg);
  vtx.sign(signers);
  return vtx;
}

async function simVtx(ixs, signers) {
  const bh = await retry(()=>conn.getLatestBlockhash("confirmed"));
  const vtx = buildVtx(ixs, signers, bh);
  const b64 = Buffer.from(vtx.serialize()).toString("base64");
  return retry(()=>conn._rpcRequest("simulateTransaction", [b64, { encoding: "base64", sigVerify: true, commitment: "confirmed" }]));
}

async function sendVtx(ixs, signers, label) {
  for (let att = 0; att < 6; att++) {
    const bh = await retry(()=>conn.getLatestBlockhash("confirmed"));
    const vtx = buildVtx(ixs, signers, bh);
    const raw = Buffer.from(vtx.serialize());
    let sig;
    try {
      sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
    } catch (e) {
      const m = String(e && e.message || e);
      if (/blockhash|expired|dropped|Already processed/i.test(m)) { console.log(label, "resending:", m.slice(0,70)); await sleep(1500); continue; }
      throw new Error(label + " send failed: " + m);
    }
    for (let p = 0; p < 40; p++) {
      await sleep(1500);
      const st = await retry(()=>conn.getSignatureStatuses([sig])).catch(()=>null);
      const s = st && st.value && st.value[0];
      if (s && s.confirmationStatus === "confirmed") { console.log(label, "-> confirmed:", sig); return sig; }
      if (s && s.err) { throw new Error(label + " FAILED on-chain: " + JSON.stringify(s.err)); }
    }
    throw new Error(label + " not confirmed after 60s: " + sig);
  }
  throw new Error(label + " failed after retries");
}

(async () => {
  const WALLET = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/root/.config/solana/id.json"))));
  const elf = fs.readFileSync("/root/streamdividend/target/deploy/streamdividend.so");
  const BUF_SPACE = 37 + elf.length;
  const elfSha = crypto.createHash("sha256").update(elf).digest("hex");

  const bal = await retry(()=>conn.getBalance(WALLET.publicKey));
  const bufRent = await retry(()=>conn.getMinimumBalanceForRentExemption(BUF_SPACE));
  console.log("ELF bytes:", elf.length, "| sha:", elfSha.slice(0,16));
  console.log("wallet:", (bal/1e9).toFixed(9), "| buffer rent:", (bufRent/1e9).toFixed(9));
  if (bal < bufRent + 200000) { console.log("ABORT: wallet below buffer rent + margin"); process.exit(1); }

  const buffer = Keypair.generate();
  console.log("new buffer account:", buffer.publicKey.toString());

  const prio  = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 });
  const prioC = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });

  // 1) create buffer (this fork's createAccount marks the new account as signer)
  const createIx = SystemProgram.createAccount({ fromPubkey: WALLET.publicKey, newAccountPubkey: buffer.publicKey, lamports: bufRent, space: BUF_SPACE, programId: LOADER });
  let res = await simVtx([prio, prioC, createIx], [WALLET, buffer]);
  if (res.error || res.result.err || res.result.value.err) { console.log("create SIM FAIL:", JSON.stringify(res.result && res.result.value && res.result.value.err || res.error)); process.exit(1); }
  console.log("1) create buffer: SIM OK units", res.result.value.unitsConsumed);

  // 2) SetBufferData chunks (1 per tx, 1023 B)
  const CH = 1023;
  const writeIxs = [];
  for (let off = 0; off < elf.length; off += CH) {
    const data = Buffer.alloc(5 + Math.min(CH, elf.length - off));
    data[0] = 2;
    data.writeUInt32LE(off, 1);
    elf.copy(data, 5, off, Math.min(off + CH, elf.length));
    writeIxs.push(new TransactionInstruction({ programId: LOADER, keys: [{ pubkey: buffer.publicKey, isSigner: true, isWritable: true }], data }));
  }
  console.log("2) write chunks:", writeIxs.length);
  for (const idx of [0, Math.floor(writeIxs.length/2), writeIxs.length-1]) {
    res = await simVtx([prio, prioC, writeIxs[idx]], [WALLET, buffer]);
    if (res.error || res.result.err || res.result.value.err) { console.log(`write[${idx}] SIM FAIL:`, JSON.stringify(res.result && res.result.value && res.result.value.err || res.error)); process.exit(1); }
  }
  console.log("   sample simulations OK (units", res.result.value.unitsConsumed + ")");

  // 3) upgrade
  const upData = Buffer.alloc(33);
  upData[0] = 4;
  upData.set(PROGRAM.toBytes(), 1);
  const upIx = new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: PDATA,    isSigner: false, isWritable: true },
      { pubkey: PROGRAM,  isSigner: false, isWritable: true },
      { pubkey: buffer.publicKey, isSigner: false, isWritable: true },
      { pubkey: WALLET.publicKey, isSigner: false, isWritable: true },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: WALLET.publicKey, isSigner: true, isWritable: false },
      { pubkey: LOADER,   isSigner: false, isWritable: false },
    ],
    data: upData,
  });
  res = await simVtx([prio, upIx], [WALLET]);
  if (res.error || res.result.err || res.result.value.err) { console.log("UPGRADE SIM FAIL:", JSON.stringify(res.result && res.result.value && res.result.value.err || res.error)); process.exit(1); }
  console.log("3) upgrade: SIM OK units", res.result.value.unitsConsumed);

  console.log("\n=== ALL SIMULATIONS PASS — broadcasting ===");
  await sendVtx([prio, prioC, createIx], [WALLET, buffer], "create buffer");
  for (let i = 0; i < writeIxs.length; i++) {
    await sendVtx([prio, prioC, writeIxs[i]], [WALLET, buffer], `write ${i+1}/${writeIxs.length}`);
    if (i % 20 === 19) console.log("   progress:", i+1, "/", writeIxs.length);
  }
  await sendVtx([prio, upIx], [WALLET], "UPGRADE");

  await sleep(3000);
  const [prog, pd, buf, wb] = await Promise.all([
    retry(()=>conn.getAccountInfo(PROGRAM)),
    retry(()=>conn.getAccountInfo(PDATA)),
    retry(()=>conn.getAccountInfo(buffer.publicKey)),
    retry(()=>conn.getBalance(WALLET.publicKey)),
  ]);
  const onSha = crypto.createHash("sha256").update(Buffer.from(prog.data.slice(45))).digest("hex");
  console.log("\n=== POST-UPGRADE VERIFICATION ===");
  console.log("programdata size:", prog.data.length, "(expected", 45 + elf.length, ")");
  console.log("on-chain ELF sha256:", onSha.slice(0,16), "| local:", elfSha.slice(0,16), onSha === elfSha ? "MATCH" : "MISMATCH");
  console.log("buffer lamports:", buf.lamports, buf.lamports === 0 ? "(drained)" : "!! should be 0");
  console.log("ProgramData lamports:", (pd.lamports/1e9).toFixed(9), "size:", pd.data.length);
  console.log("wallet now:", (wb/1e9).toFixed(9), "SOL");
})();
