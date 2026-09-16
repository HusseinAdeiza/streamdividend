#!/usr/bin/env node
// StreamDividend — mainnet vault setup
// Creates vault ATAs (AAPLx via Token-2022, USDC via v3) + calls initialize.
const {
  Keypair, PublicKey, Connection, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction,
} = require("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstructionWithDerivation,
  getAssociatedTokenAddressSync,
} = require("@solana/spl-token");

const { Program, AnchorProvider } = require("@coral-xyz/anchor");
const { BN } = require("@coral-xyz/anchor");

const PROGRAM_ID = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"); // Token-2022
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");  // v3
const URL = "https://api.mainnet-beta.solana.com";

async function main() {
  const conn = new Connection(URL, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(require("fs").readFileSync(require("os").homedir() + "/.config/solana/id.json")))
  );
  console.log("deployer/authority:", payer.publicKey.toBase58());
  console.log("balance:", (await conn.getBalance(payer.publicKey)) / 1e9, "SOL");

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), payer.publicKey.toBuffer()], PROGRAM_ID
  );
  console.log("vault PDA:", vault.toBase58());

  // Verify vault is not yet initialized
  const existing = await conn.getAccountInfo(vault, "confirmed");
  if (existing && existing.owner.equals(PROGRAM_ID)) {
    console.log("VAULT ALREADY INITIALIZED — aborting (idempotency guard).");
    return;
  }

  // NOTE: the 0.4.15 WithDerivation builder drops the token program from the
  // ATA derivation (computes the v3-seeded ATA for a 2022 mint) -> on-chain
  // "Associated address does not match seed derivation". Hand-build the
  // CreateIdempotent ix with the canonical address.
  function ataIx(payerPk, ata, owner, mint, tokenProg) {
    return new TransactionInstruction({
      keys: [
        { pubkey: payerPk, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProg, isSigner: false, isWritable: false },
      ],
      programId: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      data: Buffer.from([1]), // CreateIdempotent
    });
  }

  // 1) vault xStock ATA (Token-2022, off-curve PDA owner)
  const vaultAapl = getAssociatedTokenAddressSync(AAPLX, vault, true, TOKEN_2022_PROGRAM_ID);
  console.log("vault AAPLx ATA:", vaultAapl.toBase58());
  const ix1 = ataIx(payer.publicKey, vaultAapl, vault, AAPLX, TOKEN_2022_PROGRAM_ID);
  const sig1 = await sendAndConfirmTransaction(conn, new Transaction().add(ix1), [payer]);
  console.log("  ATA1 sig:", sig1);

  // 2) vault USDC ATA (v3)
  const vaultUsdc = getAssociatedTokenAddressSync(USDC, vault, true, TOKEN_PROGRAM_ID);
  console.log("vault USDC ATA:", vaultUsdc.toBase58());
  const ix2 = ataIx(payer.publicKey, vaultUsdc, vault, USDC, TOKEN_PROGRAM_ID);
  const sig2 = await sendAndConfirmTransaction(conn, new Transaction().add(ix2), [payer]);
  console.log("  ATA2 sig:", sig2);

  // 3) initialize
  const provider = new AnchorProvider(conn, new Wallet(payer), { commitment: "confirmed",
    sendTransaction: async (tx) => {
      const bh = (await conn.getLatestBlockhash("confirmed")).blockhash;
      tx.recentBlockhash = bh;
      tx.feePayer = payer.publicKey;
      return sendAndConfirmTransaction(conn, tx, [payer]);
    },
  });
  const program = new Program(IDL, PROGRAM_ID, provider);
  await program.methods.initialize().accounts({
    vault,
    authority: payer.publicKey,
    xstockMint: AAPLX,
    dividendMint: USDC,
    systemProgram: SystemProgram.programId,
  }).rpc();
  console.log("  initialize: ok");

  // 4) verify
  const vaultInfo = await program.account.vault.fetch(vault);
  console.log("\n=== VAULT (mainnet) ===");
  console.log("vault:", vault.toBase58());
  console.log("authority:", vaultInfo.authority.toBase58());
  console.log("xstockMint:", vaultInfo.xstockMint.toBase58(), "(AAPLx)");
  console.log("dividendMint:", vaultInfo.dividendMint.toBase58(), "(USDC)");
  console.log("totalShares:", vaultInfo.totalShares.toString());
  console.log("dividendsPerShare:", vaultInfo.dividendsPerShare.toString());
  console.log("OK — vault live");
}

const { Wallet } = require("@coral-xyz/anchor");
const IDL = JSON.parse(require("fs").readFileSync("target/idl/streamdividend.json"));

main().then(() => process.exit(0)).catch(e => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
