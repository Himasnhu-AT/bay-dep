#!/usr/bin/env python3
"""Phase A — create the project and speak the script, so the picture can be cut to the voice.

Narration comes first on purpose. Guessing caption durations and then fitting speech to them
gets both wrong; speaking first means every chip and every cut lands on a real number.
"""
import json, subprocess, pathlib, time

HERE = pathlib.Path(__file__).parent
W, H, FPS = 1080, 1920, 30
GAP = 0.10          # breath between lines


def call(tool, args, timeout=900):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": tool, "arguments": args}})
    out = subprocess.run(
        ["curl", "-s", "--max-time", str(timeout), "-X", "POST", "http://127.0.0.1:7333/mcp",
         "-H", "Content-Type: application/json",
         "-H", "Accept: application/json, text/event-stream", "-d", body],
        capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("data:"):
            out = line[5:].strip()
            break
    if not out.strip():
        raise RuntimeError(f"{tool}: empty reply")
    d = json.loads(out)
    if "error" in d:
        raise RuntimeError(f"{tool}: {json.dumps(d['error'])[:400]}")
    text = d["result"]["content"][0]["text"]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def job(tool, args):
    """Run a job-bearing tool and hand back its result.

    narrate answers in-band when the work finishes inside the request, and only makes you poll
    when it does not — so handle both. The completion flag is `finished`; there is no `state`
    field, which an earlier version of this loop waited for forever.
    """
    started = call(tool, args)
    if started.get("finished") and "result" in started:
        return started["result"]
    jid = started.get("job")
    if jid is None:
        return started
    while True:
        s = call("job_status", {"job": jid})
        if s.get("finished") or s.get("cancelled"):
            if s.get("error"):
                raise RuntimeError(f"{tool}: {s['error']}")
            return s.get("result", s)
        time.sleep(0.4)


def main():
    script = json.loads((HERE / "script.json").read_text())

    call("project_create", {"name": "loaf-of-bread", "width": W, "height": H, "fps": FPS,
                            "kit": "stadium", "background": "#000000",
                            "brief": "1923 hyperinflation: archival stills cut to a narration "
                                     "under a fixed headline, red caption chips."})

    at = 0.30           # a beat of black-free silence before the first word
    windows = []
    for line in script["lines"]:
        r = job("narrate", {"text": line["say"], "start": at, "voice": script["voice"],
                            "captions": False, "targetWordsPerSecond": 3.8,
                            "volume": 1.0})
        end = r["endSeconds"]
        windows.append({"beat": line["beat"], "show": line["show"], "say": line["say"],
                        "start": at, "end": end, "duration": end - at})
        print(f"{line['beat']:>3}  {at:6.2f} -> {end:6.2f}  ({end-at:4.2f}s)  {line['say'][:52]}")
        at = end + GAP

    plan = {"windows": windows, "narrationEnd": windows[-1]["end"],
            "duration": round(windows[-1]["end"] + 1.1, 2)}
    (HERE / "windows.json").write_text(json.dumps(plan, indent=1))
    print(f"\nnarration ends {plan['narrationEnd']:.2f}s, timeline {plan['duration']:.2f}s")


main()
