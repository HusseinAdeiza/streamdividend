import json, base64, urllib.request

def rpc(addr):
    req = urllib.request.Request(
        "https://api.mainnet-beta.solana.com",
        data=json.dumps({"jsonrpc":"2.0","id":1,"method":"getAccountInfo",
                         "params":[addr,{"encoding":"base64"}]}).encode(),
        headers={"content-type":"application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))["result"]["value"]

def b58(b):
    A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n=int.from_bytes(b,"big"); s=""
    while n>0: n,r=divmod(n,58); s=A[r]+s
    pad=0
    for x in b:
        if x==0: pad+=1
        else: break
    return "1"*pad+s

NAMES={0:"(terminator)",1:"TransferFeeConfig",2:"GroupPointer",3:"MetadataPointer",
       4:"DefaultAccountOwner",5:"TRANSFER_HOOK",6:"ConfTransferMint",7:"DefaultHSAM",
       8:"InterestRate",9:"CPIGuard",10:"GroupMemberPointer",11:"Metadata",12:"ConfTransferFee"}

def walk(data, base):
    off=base; out=[]; n=0
    while off+4<=len(data) and n<40:
        t=data[off]|(data[off+1]<<8); ln=data[off+2]|(data[off+3]<<8)
        if t==0: out.append(f"@{off} (terminator) end"); break
        if ln<4 or off+ln>len(data): break
        nm=NAMES.get(t, f"?{t}")
        body=data[off+4:off+ln]
        extra=""
        if t==5 and len(body)>=33:
            extra=" hook_prog="+b58(body[:32])+" auth_set="+str(body[32])
        if t==2 and len(body)>=33:
            extra=" group_set="+str(body[0])+" update_auth_set="+str(body[33])
        if t==3 and len(body)>=33:
            extra=" metapointer_set="+str(body[0])
        out.append(f"@{off} type={t} {nm} len={ln}{extra}")
        off+=ln; n+=1
    out.append(f"END off={off}/{len(data)} consumed_all={off==len(data)}")
    return out

def decode(base):
    v=rpc(base)
    data=base64.b64decode(v["data"][0]); owner=v["owner"]
    print(f"\n########## {base}")
    print("owner:", owner, "(Token2022)" if owner=="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" else "(v3)" if owner=="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" else "")
    print("len:", len(data))
    # base mint
    ma=data[0]==1; ma_pk=b58(data[1:33]) if ma else None
    supply=data[36:44].__class__ and int.from_bytes(data[36:44],"big")
    dec=data[44]
    init=data[45]
    fa=data[46]==1; fa_pk=b58(data[47:79]) if fa else None
    print(f"base mint: decimals={dec} supply={supply} init={init} mintAuth={ma_pk} freezeAuth={fa_pk}")
    # try walk from 82
    print("--- TLV walk from 82 ---")
    for l in walk(data, 82): print("  "+l)

decode("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp")   # AAPLx
decode("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")  # USDC
