#!/usr/bin/env python3
"""Call one bay MCP tool over HTTP and print the result.

YOU PROBABLY DO NOT NEED THIS. bay is an MCP server: call `mcp__bay__<tool>` directly as a
tool call. This script exists for exactly one situation — the server was registered during
the current session, so its tools do not appear in the tool list until the next one. It
speaks the same JSON-RPC to the same endpoint, as a stopgap.

    ./bay.py tools                          list every tool and its required arguments
    ./bay.py <tool>                         call with no arguments
    ./bay.py <tool> '<json>'                call with arguments
    ./bay.py <tool> key=value key=value     call with arguments, shell-friendly

render, narrate and subtitles_to_video return a job id rather than a result, because they take
seconds to minutes. This script polls for you and prints the finished result, so a shell
pipeline sees the same thing it always did. Pass --no-wait to get the raw job id instead.

Endpoint: BAY_MCP_URL, default http://127.0.0.1:7333/mcp
Exits non-zero on a tool error, so it composes in shell pipelines.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

URL = os.environ.get("BAY_MCP_URL", "http://127.0.0.1:7333/mcp")


def rpc(method: str, params: dict | None = None) -> dict:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        payload["params"] = params
    request = urllib.request.Request(
        URL, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            return json.load(response)
    except urllib.error.URLError as error:
        raise SystemExit(
            f"could not reach the bay MCP server at {URL}: {error}\n"
            f"start it with: cd rust && ./target/release/bay-mcp --port 7333"
        ) from error


def parse_args(argv: list[str]) -> dict:
    """Accept either one JSON blob or a series of key=value pairs."""
    if not argv:
        return {}
    if len(argv) == 1 and argv[0].lstrip().startswith("{"):
        try:
            return json.loads(argv[0])
        except json.JSONDecodeError as error:
            raise SystemExit(f"arguments are not valid JSON: {error}") from error

    args: dict = {}
    for pair in argv:
        if "=" not in pair:
            raise SystemExit(f"expected key=value or a JSON object, got {pair!r}")
        key, _, raw = pair.partition("=")
        # Let numbers and booleans through as their real types; anything else is a string.
        try:
            args[key] = json.loads(raw)
        except json.JSONDecodeError:
            args[key] = raw
    return args


def await_job(job: int) -> dict | None:
    """Poll job_status until the job finishes, then return its result.

    Without this the bootstrap path would print a job id and exit, which looks like success and
    hands back nothing usable. Progress goes to stderr so stdout stays pipeable JSON.
    """
    last = ""
    while True:
        body = rpc("tools/call", {"name": "job_status", "arguments": {"job": job}})
        text = body.get("result", {}).get("content", [{}])[0].get("text", "{}")
        try:
            state = json.loads(text)
        except json.JSONDecodeError:
            print(f"could not read job {job}: {text}", file=sys.stderr)
            return None
        if state.get("error") and not state.get("finished"):
            print(f"ERROR: {state['error']}", file=sys.stderr)
            return None
        message = state.get("message", "")
        if message and message != last:
            fraction = state.get("fraction")
            bar = f" {fraction * 100:.0f}%" if isinstance(fraction, (int, float)) else ""
            print(f"  {message}{bar}", file=sys.stderr)
            last = message
        if state.get("finished"):
            if state.get("error"):
                print(f"ERROR: {state['error']}", file=sys.stderr)
                return None
            return state.get("result") or state
        time.sleep(0.5)


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if argv else 2

    if argv[0] == "tools":
        body = rpc("tools/list")
        for tool in body["result"]["tools"]:
            required = ", ".join(tool["inputSchema"].get("required") or []) or "-"
            print(f"{tool['name']:20} {required}")
        return 0

    wait = "--no-wait" not in argv
    argv = [arg for arg in argv if arg != "--no-wait"]

    name, args = argv[0], parse_args(argv[1:])
    body = rpc("tools/call", {"name": name, "arguments": args})

    if "error" in body:
        print(f"protocol error: {body['error'].get('message', body['error'])}", file=sys.stderr)
        return 1

    result = body.get("result", {})
    text = result.get("content", [{}])[0].get("text", "")
    if result.get("isError"):
        print(f"ERROR: {text}", file=sys.stderr)
        return 1
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        print(text)
        return 0

    if wait and isinstance(value, dict) and "job" in value and not value.get("finished"):
        value = await_job(value["job"])
        if value is None:
            return 1

    print(json.dumps(value, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
