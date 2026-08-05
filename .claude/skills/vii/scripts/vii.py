#!/usr/bin/env python3
"""Call one vii MCP tool over HTTP and print the result.

    ./vii.py tools                          list every tool and its required arguments
    ./vii.py <tool>                         call with no arguments
    ./vii.py <tool> '<json>'                call with arguments
    ./vii.py <tool> key=value key=value     call with arguments, shell-friendly

Use this when the vii MCP server is running but was registered after the session started, so
the mcp__vii__* tools are not in the tool list yet. It speaks the same JSON-RPC an MCP client
would, against the same server.

Endpoint: VII_MCP_URL, default http://127.0.0.1:7333/mcp
Exits non-zero on a tool error, so it composes in shell pipelines.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

URL = os.environ.get("VII_MCP_URL", "http://127.0.0.1:7333/mcp")


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
            f"could not reach the vii MCP server at {URL}: {error}\n"
            f"start it with: cd rust && ./target/release/vii-mcp --port 7333"
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
        print(json.dumps(json.loads(text), indent=2))
    except json.JSONDecodeError:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
