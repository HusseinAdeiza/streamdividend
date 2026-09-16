import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const a = await conn.getAccountInfo(new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"));
const d = a.data;
const NAMES = {0:'(terminator)',1:'TransferFeeConfig',2:'GroupPointer',3:'MetadataPointer',4:'DefaultAccountOwner',5:'TRANSFER_HOOK',6:'ConfTransferMint',7:'DefaultHSAM',8:'InterestRate',9:'CPIGuard'};
let off = 82;
let n = 0;
while (off + 4 <= d.length && n < 40) {
  const type = d.readUInt16LE(off);
  const len = d.readUInt16LE(off + 2);
  if (type === 0) { console.log(`@${off} type=0 (end of extensions), remaining=${d.length - off} bytes`); break; }
  const name = NAMES[type] ?? `UNKNOWN(${type})`;
  let extra = '';
  if (type === 5 && off + 4 + 33 <= d.length) {
    extra = ' hook_prog=' + new PublicKey(d.subarray(off+4, off+36)).toBase58() + ' has_authority=' + d[off+36];
  }
  console.log(`@${off} type=${type} (${name}) entry_len=${len}${extra}`);
  off += len;            // len INCLUDES the 4-byte header
  n++;
}
console.log(`walked ${n} extension(s), ended at ${off} of ${d.length}`);
