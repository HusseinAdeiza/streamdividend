import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const a = await conn.getAccountInfo(new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"));
const d = a.data;
console.log("owner:", a.owner.toBase58());
console.log("total len:", d.length);
// Full hex of bytes 80..180
for (let row = 80; row < 180; row += 16) {
  let hex = "", asc = "";
  for (let i = row; i < row + 16 && i < d.length; i++) {
    hex += d[i].toString(16).padStart(2, "0") + " ";
  }
  console.log(String(row).padStart(4) + "  " + hex);
}
