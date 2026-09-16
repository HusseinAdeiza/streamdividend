import json, base64, urllib.request
def rpc(addr):
    req = urllib.request.Request("https://api.mainnet-beta.solana.com",
        data=json.dumps({"jsonrpc":"2.0","id":1,"method":"getAccountInfo",
            "params":[addr,{"encoding":"base64"}]}).encode(),
        headers={"content-type":"application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))["result"]["value"]
def b58(b):
    A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n=int.from_bytes(b,"big"); s=""
    while n>0: n,r=divmod(n,58); s=A[r]+s
    p=0
    for x in b:
        if x==0: p+=1
        else: break
    return "1"*p+s
NAMES={0:"(terminator)",1:"TransferFeeConfig",2:"GroupPointer",3:"MetadataPointer",
       4:"DefaultAccountOwner",5:"TRANSFER_HOOK",6:"ConfTransferMint",7:"DefaultHSAM",
       8:"InterestRate",9:"CPIGuard",10:"GroupMemberPointer",11:"Metadata",12:"ConfTransferFee"}
def walk(data, base, incl):
    off=base; out=[]; n=0
    while off+4<=len(data) and n<40:
        t=data[off]|(data[off+1]<<8); ln=data[off+2]|(data[off+3]<<8)
        if t==0: out.append(f"@{off} (terminator) end"); break
        step = ln if incl else ln+4
        if step<4 or off+step>len(data): break
        body=data[off+4:off+ln]
        extra=""
        if t==5 and len(body)>=33: extra=" HOOK_prog="+b58(body[:32])+" auth="+str(body[32])
        out.append(f"@{off} type={t} {NAMES.get(t,'?')} len={ln}{extra}")
        off+=step; n+=1
    out.append(f"END off={off}/{len(data)} all_consumed={off==len(data)}")
    return out
def decode(base):
    v=rpc(base); data=base64.b64decode(v["data"][0]); owner=v["owner"]
    print(f"\n##### {base}  len={len(data)}  owner={'2022' if owner.startswith('TokenzQdB') else 'v3' if owner.startswith('Tokenkeg') else owner}")
    ma=data[0]; ma_pk=b58(data[1:33]) if ma else None
    supply=int.from_bytes(data[33:41],"big"); dec=data[41]; init=data[42]
    fa=data[43]; fa_pk=b58(data[44:76]) if fa else None
    print(f"  decimals={dec} supply={supply} init={init} mintAuth={ma_pk} freeze={fa_pk}")
    for incl,label in [(True,"len=incl-header"),(False,"len=excl-header")]:
        print(f"  --- walk base=76 ({label}) ---")
        for l in walk(data,76,incl): print("    "+l)
decode("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp")  # AAPLx
