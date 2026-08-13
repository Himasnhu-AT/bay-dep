import json,subprocess
def call(tool,args,t=900):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":tool,"arguments":args}})
    out=subprocess.run(["curl","-s","--max-time",str(t),"-X","POST","http://127.0.0.1:7333/mcp",
        "-H","Content-Type: application/json","-H","Accept: application/json, text/event-stream",
        "-d",body],capture_output=True,text=True).stdout
    for line in out.splitlines():
        if line.startswith("data:"): out=line[5:].strip(); break
    d=json.loads(out)
    if "error" in d: raise RuntimeError(json.dumps(d["error"])[:250])
    return json.loads(d["result"]["content"][0]["text"])

cards=json.load(open("cards1929.json"))["cards"]
bank={}
for i,c in enumerate(cards):
    try:
        r=call("stock_search",{"query":c["q"],"describe":c["d"],"limit":10,"minWidth":600})
    except Exception as e:
        print(f"{i:2} ERROR {e}"); continue
    res=r.get("results",[])
    bank[str(i)]={"card":c["show"],"q":c["q"],"separation":r.get("separation"),"results":res}
    sep=r.get('separation')
    print(f"\n{i:2}. {' / '.join(c['show'])}   sep={sep if sep is None else round(sep,4)}  n={len(res)}")
    for x in res[:3]:
        lic=x['licence']; lic=lic if isinstance(lic,str) else list(lic)[0]
        print(f"     {x['score']:+.4f} was#{x['was']:<2} {lic:14} {x['title'][:56]}")
json.dump(bank,open("bank1929.json","w"),indent=1)
print("\nwrote bank1929.json")
