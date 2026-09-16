import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const mints = [
  ["AAPLx", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"],
  ["USDC",  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
];
for (const [name, addr] of mints) {
  const a = await conn.getAccountInfo(new PublicKey(addr));
  const is2022 = a.owner.equals(TOKEN_2022_PROGRAM_ID);
  const m = await getMint(conn, new PublicKey(addr), "confirmed", is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
  console.log(`${name}: ${is2022?"Token-2022":"Token-v3"} decimals=${m.decimals} supply=${m.supply} mintAuth=${m.mintAuthority ? (m.mintAuthority.toBase58()||"none"):"none"} freezeAuth=${m.freezeAuthority ? m.freezeAuthority.toBase58() : "none"}`);
}
