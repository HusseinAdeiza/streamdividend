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
data = base64.b64decode(resp["result"]["value"]["data"][0])
print("len:", len(data))

# Find where "Apple xStock" appears
idx = data.find(b"Apple xStock")
print("Apple xStock at byte:", idx)
# The metadata body precedes it; the TLV header (4 bytes) is a bit before.
# Scan back to find a plausible TLV type/len pair.
for start in range(idx - 200, idx, 4):
    if start < 0: continue
    t = data[start] | (data[start+1] << 8)
    ln = data[start+2] | (data[start+3] << 8)
    if t == 11:  # Metadata extension type = 11? Actually metadata=11
        print(f"  candidate Metadata TLV @ {start}: type={t} len={ln}")
    if t == 3:   # MetadataPointer = 3
        print(f"  candidate MetadataPointer @ {start}: type={t} len={ln}")

# Now do a FULL correct walk. Token-2022 base Mint length:
# Mint struct = 82 bytes. But there may be a 'extension' region.
# Let's find the FIRST nonzero after 82 that forms a valid TLV.
import struct
def try_walk(base):
    off = base
    out = []
    N = {0:"TERM",1:"TransferFeeConfig",2:"GroupPointer",3:"MetadataPointer",
         4:"DefaultAccountOwner",5:"TRANSFER_HOOK",6:"ConfTransferMint",
         7:"DefaultHSAM",8:"InterestRate",9:"CPIGuard",10:"GroupMemberPointer",
         11:"Metadata",12:"ConfTransferFeeConfig"}
    steps = 0
    while off + 4 <= len(data) and steps < 40:
        t = data[off] | (data[off+1] << 8)
        ln = data[off+2] | (data[off+3] << 8)
        if t == 0:
            out.append(f"@{off} TERM (left {len(data)-off})")
            break
        if ln < 4 or off + ln > len(data):
            out.append(f"@{off} type={t} len={ln} INVALID (stop)")
            break
        out.append(f"@{off} type={t} ({N.get(t,'?')}) len={ln}")
        off += ln
        steps += 1
    return out

for base in [82, 80, 108, 165, 168]:
    print(f"\n=== walk from base={base} ===")
    for line in try_walk(base):
        print("  " + line)
