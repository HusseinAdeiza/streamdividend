import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Streamdividend } from "../target/types/streamdividend";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  mintTo,
  createMint,
  getAccount,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { TokenProgram } from "@solana/spl-token";
import { assert } from "chai";

describe("streamdividend", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider as any);
  const program = anchor.workspace.Streamdividend as Program<Streamdividend>;
  const wallet = provider.wallet as any;
  const authority = wallet.pubkey as PublicKey;
  const authorityKeypair = wallet.payer as Keypair;

  let vaultMint: PublicKey; // tokenized stock mint (AAPLx)
  let dividendMint: PublicKey; // USDC stand-in (6 dec)
  let vault: PublicKey;
  let vaultXstock: PublicKey;
  let vaultDividend: PublicKey;
  let authorityStockAta: PublicKey;
  let authorityDividendAta: PublicKey;
  let user: Keypair;

  const TOKEN = TokenProgram.programId;

  before(async () => {
    vaultMint = await createMint(
      provider as any,
      authorityKeypair,
      authority,
      null,
      6
    );
    dividendMint = await createMint(
      provider as any,
      authorityKeypair,
      authority,
      null,
      6
    );

    [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), authority.toBytes()],
      program.programId
    );
    [vaultXstock] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_xstock"), vault.toBytes()],
      program.programId
    );
    [vaultDividend] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_dividend"), vault.toBytes()],
      program.programId
    );

    await program.methods
      .initialize(vaultMint, dividendMint)
      .accounts({
        authority,
        vault,
        vaultXstock,
        vaultDividend,
        xstockMint: vaultMint,
        dividendMint: dividendMint,
        tokenProgram: TOKEN,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([authorityKeypair])
      .rpc();

    // Authority ATAs + funding
    authorityStockAta = getAssociatedTokenAddressSync(vaultMint, authority);
    await createAssociatedTokenAccount(
      provider as any,
      vaultMint,
      authority,
      undefined,
      authorityKeypair
    );
    await mintTo(
      provider as any,
      vaultMint,
      authorityStockAta,
      authorityKeypair,
      0,
      2_000_000_000n // 2,000,000 AAPLx
    );

    authorityDividendAta = getAssociatedTokenAddressSync(
      dividendMint,
      authority
    );
    await createAssociatedTokenAccount(
      provider as any,
      dividendMint,
      authority,
      undefined,
      authorityKeypair
    );
    await mintTo(
      provider as any,
      dividendMint,
      authorityDividendAta,
      authorityKeypair,
      0,
      10_000_000_000n // 10,000,000 USDC to distribute
    );

    // Second user
    user = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.sendTransaction(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: authority,
            toPubkey: user.publicKey,
            lamports: 10_000_000_000,
          })
        )
      )
    );
    const userStockAta = getAssociatedTokenAddressSync(vaultMint, user.publicKey);
    await createAssociatedTokenAccount(
      provider as any,
      vaultMint,
      user.publicKey,
      undefined,
      user
    );
    await mintTo(
      provider as any,
      vaultMint,
      userStockAta,
      authorityKeypair,
      0,
      1_000_000_000n // 1,000,000 AAPLx
    );
  });

  it("initializes the vault", async () => {
    const acc = (await program.account.vault.fetch(vault)) as any;
    assert.equal(acc.authority.toBase58(), authority.toBase58());
    assert.equal(acc.xstockMint.toBase58(), vaultMint.toBase58());
    assert.equal(acc.dividendMint.toBase58(), dividendMint.toBase58());
    assert.equal(acc.totalShares, 0n);
    assert.equal(acc.dividendsPerShare, 0n);
  });

  it("deposits stock and mints 1:1 shares", async () => {
    await program.methods
      .deposit(1_000_000_000n) // 1,000,000 AAPLx
      .accounts({
        user: authority,
        vault,
        userState: PublicKey.findProgramAddressSync(
          [
            Buffer.from("user"),
            vault.toBytes(),
            authority.toBytes(),
          ],
          program.programId
        )[0],
        userXstock: authorityStockAta,
        vaultXstock,
        xstockMint: vaultMint,
        tokenProgram: TOKEN,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorityKeypair])
      .rpc();

    const acc = (await program.account.vault.fetch(vault)) as any;
    assert.equal(acc.totalShares, 1_000_000_000n);
    assert.equal(acc.totalXstock, 1_000_000_000n);

    const bal = await getAccount(provider.connection, authorityStockAta);
    assert.equal(bal.amount, 1_000_000_000n);
  });

  it("second depositor gets pro-rata shares", async () => {
    const userStockAta = getAssociatedTokenAddressSync(
      vaultMint,
      user.publicKey
    );
    await program.methods
      .deposit(500_000_000n) // 500,000 AAPLx
      .accounts({
        user: user.publicKey,
        vault,
        userState: PublicKey.findProgramAddressSync(
          [Buffer.from("user"), vault.toBytes(), user.publicKey.toBytes()],
          program.programId
        )[0],
        userXstock: userStockAta,
        vaultXstock,
        xstockMint: vaultMint,
        tokenProgram: TOKEN,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const acc = (await program.account.vault.fetch(vault)) as any;
    assert.equal(acc.totalShares, 1_500_000_000n);
    assert.equal(acc.totalXstock, 1_500_000_000n);
  });

  it("authority triggers a pro-rata dividend", async () => {
    await program.methods
      .triggerDividend(6_000_000_000n) // 6,000,000 USDC total
      .accounts({
        authority,
        vault,
        adminDividend: authorityDividendAta,
        vaultDividend,
        tokenProgram: TOKEN,
      })
      .signers([authorityKeypair])
      .rpc();

    const acc = (await program.account.vault.fetch(vault)) as any;
    assert.equal(acc.dividendPool, 6_000_000_000n);
    assert.equal(acc.totalDividendsDistributed, 6_000_000_000n);
    // per-share = 6,000,000_000 * 1e12 / 1,500,000_000 = 4e12 (4 USDC per share, in 1e12 scale)
    assert.equal(acc.dividendsPerShare, 4_000_000_000_000n);
  });

  it("non-authority cannot trigger a dividend", async () => {
    const userStockAta = getAssociatedTokenAddressSync(
      vaultMint,
      user.publicKey
    );
    await assert.isRejected(
      program.methods
        .triggerDividend(1_000_000n)
        .accounts({
          authority: user.publicKey,
          vault,
          adminDividend: authorityDividendAta,
          vaultDividend,
          tokenProgram: TOKEN,
        })
        .signers([user])
        .rpc(),
      /Caller is not the vault authority/
    );
  });

  it("reports accrued dividends pro-rata (earned view)", async () => {
    // authority has 1,000,000_000 shares of 1,500,000_000 → 2/3 of 6M = 4M USDC
    const authEarned = await program.methods.earned().accounts({
      user: authority,
      vault,
      userState: PublicKey.findProgramAddressSync(
        [Buffer.from("user"), vault.toBytes(), authority.toBytes()],
        program.programId
      )[0],
    });
    // anchor returns the view via program.methods.earned().accounts(...).rpc()
    const res: any = await (program.methods.earned as any)()
      .accounts({
        user: authority,
        vault,
        userState: PublicKey.findProgramAddressSync(
          [Buffer.from("user"), vault.toBytes(), authority.toBytes()],
          program.programId
        )[0],
      })
      .rpc();
    assert.equal(res, 4_000_000_000n);

    const userEarned: any = await (program.methods.earned as any)()
      .accounts({
        user: user.publicKey,
        vault,
        userState: PublicKey.findProgramAddressSync(
          [Buffer.from("user"), vault.toBytes(), user.publicKey.toBytes()],
          program.programId
        )[0],
      })
      .rpc();
    assert.equal(userEarned, 2_000_000_000n); // 1/3 of 6M
  });

  it("authority claims full accrued dividend in USDC", async () => {
    const before = await getAccount(
      provider.connection,
      authorityDividendAta
    );
    await program.methods
      .claimDividend()
      .accounts({
        user: authority,
        vault,
        userState: PublicKey.findProgramAddressSync(
          [Buffer.from("user"), vault.toBytes(), authority.toBytes()],
          program.programId
        )[0],
        userDividend: authorityDividendAta,
        vaultDividend,
        tokenProgram: TOKEN,
      })
      .signers([authorityKeypair])
      .rpc();
    const after = await getAccount(provider.connection, authorityDividendAta);
    assert.equal(after.amount - before.amount, 4_000_000_000n);

    const acc = (await program.account.vault.fetch(vault)) as any;
    assert.equal(acc.dividendPool, 2_000_000_000n); // only user's share left
  });

  it("second user claims their share", async () => {
    const userDivAta = getAssociatedTokenAddressSync(
      dividendMint,
      user.publicKey
    );
    await createAssociatedTokenAccount(
      provider as any,
      dividendMint,
      user.publicKey,
      undefined,
      user
    );
    const before = await getAccount(provider.connection, userDivAta);
    await program.methods
      .claimDividend()
      .accounts({
        user: user.publicKey,
        vault,
        userState: PublicKey.findProgramAddressSync(
          [Buffer.from("user"), vault.toBytes(), user.publicKey.toBytes()],
          program.programId
        )[0],
        userDividend: userDivAta,
        vaultDividend,
        tokenProgram: TOKEN,
      })
      .signers([user])
      .rpc();
    const after = await getAccount(provider.connection, userDivAta);
    assert.equal(after.amount - before.amount, 2_000_000_000n);

    const acc = (await program.account.vault.fetch(vault)) as any;
    assert.equal(acc.dividendPool, 0n); // fully distributed
  });

  it("claiming twice yields nothing (idempotent accumulator)", async () => {
    await assert.isRejected(
      program.methods
        .claimDividend()
        .accounts({
          user: authority,
          vault,
          userState: PublicKey.findProgramAddressSync(
            [Buffer.from("user"), vault.toBytes(), authority.toBytes()],
            program.programId
          )[0],
          userDividend: authorityDividendAta,
          vaultDividend,
          tokenProgram: TOKEN,
        })
        .signers([authorityKeypair])
        .rpc(),
      /Nothing to claim/
    );
  });

  it("withdraw pays out dividends first, then xStock", async () => {
    // Trigger another dividend while user holds 500k shares.
    await program.methods
      .triggerDividend(3_000_000_000n) // 3,000,000 USDC
      .accounts({
        authority,
        vault,
        adminDividend: authorityDividendAta,
        vaultDividend,
        tokenProgram: TOKEN,
      })
      .signers([authorityKeypair])
      .rpc();
    // per-share = 3M_000 * 1e12 / 1.5M = 2e12 → user (500k shares) earns 1M USDC
    const userStockAta = getAssociatedTokenAddressSync(
      vaultMint,
      user.publicKey
    );
    const userDivAta = getAssociatedTokenAddressSync(
      dividendMint,
      user.publicKey
    );
    const divBefore = await getAccount(provider.connection, userDivAta);
    await program.methods
      .withdraw(500_000_000n)
      .accounts({
        user: user.publicKey,
        vault,
        userState: PublicKey.findProgramAddressSync(
          [Buffer.from("user"), vault.toBytes(), user.publicKey.toBytes()],
          program.programId
        )[0],
        userXstock: userStockAta,
        vaultXstock,
        userDividend: userDivAta,
        vaultDividend,
        tokenProgram: TOKEN,
      })
      .signers([user])
      .rpc();
    const divAfter = await getAccount(provider.connection, userDivAta);
    assert.equal(divAfter.amount - divBefore.amount, 1_000_000_000n);

    const acc = (await program.account.vault.fetch(vault)) as any;
    assert.equal(acc.totalShares, 1_000_000_000n); // authority's remains
    assert.equal(acc.totalXstock, 1_000_000_000n);
  });

  it("sets route preference", async () => {
    await program.methods
      .setRoute("AutoCompound")
      .accounts({
        user: authority,
        vault,
        userState: PublicKey.findProgramAddressSync(
          [Buffer.from("user"), vault.toBytes(), authority.toBytes()],
          program.programId
        )[0],
      })
      .signers([authorityKeypair])
      .rpc();
    const us = (await program.account.userState.fetch(
      PublicKey.findProgramAddressSync(
        [Buffer.from("user"), vault.toBytes(), authority.toBytes()],
        program.programId
      )[0]
    )) as any;
    assert.equal(us.route, "AutoCompound");
  });
});
