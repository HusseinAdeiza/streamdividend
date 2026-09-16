import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const mints = {
  "AAPLx": "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  "USDC":  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
for (const [name, addr] of Object.entries(mints)) {
  const a = await conn.getAccountInfo(new PublicKey(addr));
  const d = a.data;
  const opt = (off) => d[off] ? new PublicKey(d.subarray(off+1, off+33)).toBase58() : null;
  const supply = Number(d.readBigUInt64LE(33));
  const decimals = d[41];
  console.log(`${name}: decimals=${decimals} supply=${supply} mintAuth=${opt(0)} freezeAuth=${opt(43)} dataLen=${d.length}`);
}
