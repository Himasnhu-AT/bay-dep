#!/usr/bin/env python3
"""Run one stock_search per beat through bay's MCP server and record the ranked candidates."""
import json, subprocess, sys, pathlib

HERE = pathlib.Path(__file__).parent
BEATS = json.loads((HERE / "beats.json").read_text())


def call(tool, args, timeout=600):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": tool, "arguments": args}})
    out = subprocess.run(
        ["curl", "-s", "--max-time", str(timeout), "-X", "POST",
         "http://127.0.0.1:7333/mcp",
         "-H", "Content-Type: application/json",
         "-H", "Accept: application/json, text/event-stream",
         "-d", body],
        capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("data:"):
            out = line[5:].strip()
            break
    d = json.loads(out)
    if "error" in d:
        raise RuntimeError(d["error"])
    return json.loads(d["result"]["content"][0]["text"])


def main():
    only = set(int(a) for a in sys.argv[1:]) if len(sys.argv) > 1 else None
    bank_path = HERE / "bank.json"
    bank = json.loads(bank_path.read_text()) if bank_path.exists() else {}

    for beat in BEATS["beats"]:
        n = beat["n"]
        if only and n not in only:
            continue
        try:
            res = call("stock_search", {"query": beat["q"], "describe": beat["d"], "limit": 8,
                                        "minWidth": 400, "licence": "allow-sharealike"})
        except Exception as e:
            print(f"{n:2}  ERROR {e}")
            continue
        results = res.get("results", [])
        sep = res.get("separation")
        print(f"\n{n:2}. {' / '.join(beat['caption'])}")
        print(f"    q={beat['q']!r}  sep={sep if sep is None else round(sep,4)}  n={len(results)}")
        for r in results[:4]:
            lic = r["licence"]
            lic = lic if isinstance(lic, str) else list(lic)[0]
            print(f"      {r['score']:+.4f} was#{r['was']:<2} {lic:14} {r['title'][:58]}")
        bank[str(n)] = {"caption": beat["caption"], "query": beat["q"],
                        "describe": beat["d"], "separation": sep, "results": results}

    bank_path.write_text(json.dumps(bank, indent=1))
    print(f"\nwrote {bank_path} with {len(bank)} beats")


main()
