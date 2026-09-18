// Diagnose sendRawTransaction failure mode on public RPC.
const { Connection, Keypair, PublicKey, Transaction, SystemProgram } = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
} = require("@solana/spl-token");
const fs = require("fs");
const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AUTH = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const owner = Keypair.generate();
  const destAta = getAssociatedTokenAddressSync(AAPLX, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const rent = await c.getMinimumBalanceForRentExemption(165);
  const tx1 = new Transaction();
  tx1.add(SystemProgram.transfer({ fromPubkey: AUTH.publicKey, toPubkey: owner.publicKey, lamports: rent }));
  tx1.add(createAssociatedTokenAccountIdempotentInstruction(AUTH.publicKey, destAta, owner.publicKey, AAPLX, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  tx1.feePayer = AUTH.publicKey;

  for (let a = 0; a < 3; a++) {
    try {
      const bh = (await c.getLatestBlockhash("confirmed")).blockhash;
      tx1.recentBlockhash = bh; tx1.sign(AUTH);
      const sig = await c.sendRawTransaction(tx1.serialize(), { maxRetries: 3 });
      console.log("SEND OK:", sig);
      for (let i = 0; i < 30; i++) {
        const st = await c.getSignatureStatuses([sig]);
        const r = st.value[0];
        if (r) {
          console.log(`  poll ${i}:`, r.confirmationStatus, r.err ? "ERR " + JSON.stringify(r.err) : "");
          if (r.err) return;
          if (r.confirmationStatus === "confirmed" || r.confirmationStatus === "finalized") return console.log("CONFIRMED");
        }
        await sleep(2000);
      }
      return console.log("timeout");
    } catch (e) {
      console.log(`attempt ${a} send error:`, e.message.split("\n").slice(0, 6).join("\n"));
      await sleep(4000);
    }
  }
})();
