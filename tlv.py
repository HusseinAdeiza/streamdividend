import json, base64, urllib.request

req = urllib.request.Request(
    "https://api.mainnet-beta.solana.com",
    data=json.dumps({
        "jsonrpc": "2.0", "id": 1,
        "method": "getAccountInfo",
        "params": ["XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
                   {"encoding": "base64"}],
    }).encode(),
    headers={"content-type": "application/json"},
)
resp = json.load(urllib.request.urlopen(req, timeout=30))
val = resp["result"]["value"]
data = base64.b64decode(val["data"][0])
owner = val["owner"]
print("owner:", owner)
print("len:", len(data))
print("base mint = 82 bytes")

NAMES = {0:"TERMINATOR",1:"TransferFeeConfig",2:"GroupPointer",3:"MetadataPointer",
         4:"DefaultAccountOwner",5:"TRANSFER_HOOK",6:"ConfTransferMint",
         7:"DefaultHSAM",8:"InterestRate",9:"CPIGuard"}

off = 82
seen = 0
while off + 4 <= len(data) and seen < 30:
    t = data[off] | (data[off+1] << 8)
    ln = data[off+2] | (data[off+3] << 8)
    if t == 0:
        print(f"@{off} TLV terminator, {len(data)-off} bytes left -> extensions done")
        break
    extra = ""
    body = data[off+4:off+ln]
    if t == 5 and len(body) >= 32:
        prog = body[:32]
        extra = " hook_program=" + bytes(prog).hex()
    name = NAMES.get(t, f"UNKNOWN({t})")
    print(f"@{off} type={t} ({name}) entry_len={ln} body_len={len(body)}{extra}")
    off += ln
    seen += 1
print(f"walked {seen} entries, ended at {off}")
