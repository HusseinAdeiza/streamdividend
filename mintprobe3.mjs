import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token/extension/publicKey";
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const mints = [
  ["AAPLx", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"],
  ["USDC",  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
];
for (const [name, addr] of mints) {
  const a = await conn.getAccountInfo(new PublicKey(addr));
  const owner = a.owner.toBase58();
  const prog = owner === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const m = await getMint(conn, new PublicKey(addr), "confirmed", prog);
  console.log(`${name}: owner=${owner === TOKEN_2022_PROGRAM_ID.toBase58() ? "Token2022" : "Token-v3"} decimals=${m.decimals} supply=${m.supply} mintAuth=${m.mintAuthority} freezeAuth=${m.freezeAuthority}`);
}
