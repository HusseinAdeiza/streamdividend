const { Connection, PublicKey } = require("@solana/web3.js");
const { MINT_SIZE } = require("@solana/spl-token");
(async () => {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const info = await conn.getAccountInfo(new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"));
  const d = info.data;
  console.log("MINT_SIZE =", MINT_SIZE, " data len =", d.length, " tlv bytes =", d.length - MINT_SIZE);
  const NAMES={0:"METADATA",1:"TRANSFER-FEE-CONFIG",2:"TRANSFER-FEE-AMOUNT",3:"MINT-CLOSE-AUTH",4:"CONF-MINT",5:"DEFAULT-ACCT-STATE",6:"INTEREST-RATE",7:"CONF-ACCT",8:"TRANSFER-HOOK",9:"WITHDRAWAL-EXEMPT",10:"MEMO-TRANSFER",11:"PERMANENT-DELEGATE",12:"NON-TRANSFERABLE"};
  let off = MINT_SIZE, i=0;
  while (off + 2 <= d.length) {
    const type = d.readUInt16LE(off), len = d.readUInt16LE(off+2);
    const dataStart = off+4, data = d.slice(dataStart, dataStart+len);
    console.log(`[#${i}] type=${type} (${NAMES[type]||"UNKNOWN"}) len=${len}`);
    if (type===0) {
      // bincode: 3 Strings + COption<Pubkey>
      let p=0, out=[];
      for (let k=0;k<3;k++){ const sl=data.readUInt32LE(p); p+=4; out.push(data.toString("utf8",p,p+sl)); p+=sl; }
      const ua = data[p+1]==0? "none" : data.slice(p+1,p+33).toString("hex");
      console.log("    name=",out[0],"symbol=",out[1],"updateAuth=",ua);
      console.log("    uri=",out[2].slice(0,300));
    }
    if (type===8) {
      console.log("    *** HOOK PROGRAM (pubkey 0..32):", data.slice(0,32).toString("hex"));
    }
    if (type===1) console.log("    (transfer fee config — affects transfer amounts)");
    if (type===12) console.log("    (non-transferable — CANNOT deposit!)");
    if (type===5) console.log("    (default account state, affects init only)");
    off = dataStart + len; i++;
  }
  console.log("walk ended at", off, "== data len", d.length, off===d.length ? "EXACT" : "MISMATCH");
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
