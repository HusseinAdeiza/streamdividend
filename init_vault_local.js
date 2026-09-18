// Initialize the vault PDA on the local cluster (mirrors mainnet setup).
// Uses the app's IDL + anchor 0.29, same PDA seeds -> same vault address as mainnet.
const fs = require("fs");
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { AnchorProvider, Program } = require("@coral-xyz/anchor");

const RPC = "http://localhost:8899";
const DEMO = "/root/streamdividend-video/demo";
const idl = JSON.parse(fs.readFileSync("/root/streamdividend-app/src/lib/idl.json", "utf8"));

(async () => {
  const env = JSON.parse(fs.readFileSync(DEMO + "/chain.env", "utf8"));
  const connection = new Connection(RPC, "confirmed");
  const auth = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))));
  const provider = new AnchorProvider(connection, {
    publicKey: auth.publicKey,
    signTransaction: (tx) => auth.signTransaction(tx),
    signAllTransactions: (txs) => Promise.all(txs.map((t) => auth.signTransaction(t))),
  }, { preflightCommitment: "confirmed", commitment: "confirmed" });
  const program = new Program(idl, "LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA", provider);

  const aapl = new PublicKey(env.AAPL_MINT);
  const usdc = new PublicKey(env.USDC_MINT);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), auth.publicKey.toBuffer()],
    program.programId
  );
  console.log("vault PDA:", vault.toBase58(), "(mainnet vault: 2vsxDXuanJxrWtBzhun6yaCidHZxVNdFEobtAC3CKwM2)");

  const tx = await program.methods.initialize().accounts({
    vault, xstockMint: aapl, dividendMint: usdc, authority: auth.publicKey, systemProgram: SystemProgram.programId,
  }).transaction();
  tx.feePayer = auth.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(auth); const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig);
  console.log("vault initialized:", sig);

  // also create the vault's token ATAs (mirrors mainnet)
  const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require("@solana/spl-token");
  const { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
  const vaultAaplAta = await getAssociatedTokenAddress(aapl, vault, true, TOKEN_2022_PROGRAM_ID);
  const vaultUsdcAta = await getAssociatedTokenAddress(usdc, vault, true);
  const t2 = new (require("@solana/web3.js").Transaction)();
  t2.add(createAssociatedTokenAccountInstruction(auth.publicKey, vaultAaplAta, vault, aapl, TOKEN_2022_PROGRAM_ID));
  t2.add(createAssociatedTokenAccountInstruction(auth.publicKey, vaultUsdcAta, vault, usdc, TOKEN_PROGRAM_ID));
  t2.feePayer = auth.publicKey;
  t2.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  t2.sign(auth); const sig2 = await connection.sendRawTransaction(t2.serialize());
  await connection.confirmTransaction(sig2);
  console.log("vault ATAs:", sig2);
  env.vault = vault.toBase58();
  env.vaultAaplAta = vaultAaplAta.toBase58();
  env.vaultUsdcAta = vaultUsdcAta.toBase58();
  fs.writeFileSync(DEMO + "/chain.env", JSON.stringify(env, null, 2));

  // print balances with tokenAmount
  const { getAccount } = require("@solana/spl-token");
  const user = new PublicKey(env.USER);
  const ataUserAapl = new PublicKey(env.ataUserAapl);
  const acc = await getAccount(connection, ataUserAapl, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log("user AAPLx:", acc.tokenAmount.uiAmountString);
  const authUsdcAta = new PublicKey(env.ataAuthUsdc);
  const acc2 = await getAccount(connection, authUsdcAta, "confirmed");
  console.log("auth USDC :", acc2.tokenAmount.uiAmountString);
})().catch(e => { console.error("ERR", e.stack); process.exit(1); });
