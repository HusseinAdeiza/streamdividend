import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const mints = {
  "AAPLx": "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  "USDC":  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
const T2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const T3 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
for (const [name, addr] of Object.entries(mints)) {
  const a = await conn.getAccountInfo(new PublicKey(addr));
  if (!a) { console.log(name, "none"); continue; }
  const owner = a.owner.toBase58();
  // mint data layout (v3): mintAuthority(36: option<32>), freeze(36), decimals(1), supply(8), ...
  const d = a.data;
  const opt = (off) => { const has = d[off]; const pk = has ? new PublicKey(d.subarray(off+1, off+33)).toBase58() : null; return pk; };
  const mintAuth = opt(0), freezeAuth = opt(36);
  const decimals = d[72];
  const supply = Number(d.readBigUInt64LE(73));
  console.log(`\n=== ${name} (${addr}) ===`);
  console.log("owner:", owner === T2022 ? "TOKEN-2022" : owner === T3 ? "TOKEN v3" : owner);
  console.log("mintAuthority:", mintAuth);
  console.log("freezeAuthority:", freezeAuth);
  console.log("decimals:", decimals, "supply:", supply);
  console.log("dataLen:", d.length, "(v3 mint=82, 2022 with ext =", d.length, ")");
}
