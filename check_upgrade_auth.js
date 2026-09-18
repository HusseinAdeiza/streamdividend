// Verify: who is the upgrade authority, and can we redeploy?
const { Connection, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
(async () => {
  const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const prog = new PublicKey("LuTgK5iC7MvcnWGeJTsXpZH6bHZ4Cf95m333U8ed9kA");
  const loader = new PublicKey("BPFLoaderUpgradeab1e1111111111111111111");
  const [pd] = PublicKey.findProgramAddressSync(
    [Buffer.from(prog.toBytes()), Buffer.from("ProgramData")],
    loader
  );
  const acc = await c.getAccountInfo(pd);
  if (!acc) return console.log("programdata missing");
  const d = acc.data;
  const authority = new PublicKey(d.slice(36, 68)).toBase58();
  const deployer = new PublicKey(
    fs.readFileSync("target/deploy/streamdividend-keypair.json")
  ).toBase58();
  const wallet = new PublicKey(
    JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))
  ).toBase58();
  const p = await c.getAccountInfo(prog);
  const bal = await c.getBalance(new PublicKey(
    JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8"))
  ));
  console.log("programdata   :", pd.toBase58());
  console.log("UPGRADE AUTH  :", authority);
  console.log("deploy keypair:", deployer);
  console.log("our wallet    :", wallet);
  console.log("upgrade==deploy keypair :", authority === deployer);
  console.log("upgrade==our wallet     :", authority === wallet);
  console.log("program on-chain size  :", p.value ? p.value.data.length + " bytes" : "GONE");
  console.log("our wallet SOL         :", bal / 1e9);
})();
