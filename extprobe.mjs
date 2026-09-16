import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const EXT_NAMES = {
  0: "Uninitialized", 1: "TransferFeeConfig", 2: "GroupPointer", 3: "MetadataPointer",
  4: "DefaultAccountOwner", 5: "TransferHook", 6: "ConfidentialTransferMint",
  7: "DefaultHSAM", 8: "InterestRateConfig", 9: "CPIGuard",
};
const a = await conn.getAccountInfo(AAPLX);
const d = a.data;
console.log("mint data len:", d.length, "base mint = 82 bytes, extension bytes =", d.length - 82);
// TLV walk: [type:u16][len:u16][data]
let off = 82;
const found = [];
while (off + 4 <= d.length) {
  const type = d.readUInt16LE(off);
  const len = d.readUInt16LE(off + 2);
  off += 4;
  if (type === 0) { found.push(`type=0 (uninitialized) len=${len}`); break; }
  const name = EXT_NAMES[type] ?? `unknown(${type})`;
  let detail = "";
  if (type === 5) { // TransferHook: [program_id:32][authority:option<32>]
    const prog = new PublicKey(d.subarray(off, off + 32)).toBase58();
    detail = " hook_program=" + prog + " authority_set=" + d[off + 32];
  }
  if (type === 2) { // GroupPointer: [group_key:option<32>][update_authority:option<32>]
    detail = " group_set=" + d[off] + " update_auth_set=" + d[off + 33];
  }
  found.push(`type=${type} (${name}) len=${len}${detail}`);
  off += len;
}
console.log("extensions:", found.join(" | ") || "NONE (base mint only)");
