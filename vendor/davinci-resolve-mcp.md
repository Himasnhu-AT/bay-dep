# The Resolve connector

`vendor/davinci-resolve-mcp/` is a clone of
[samuelgursky/davinci-resolve-mcp](https://github.com/samuelgursky/davinci-resolve-mcp) (MIT) with
a Python 3.11 venv beside it. It is gitignored, never shipped inside bay and never fetched by bay:
`script/setup-resolve-mcp.sh` makes it, at the commit pinned in that script (v2.103.3).

bay finds it in `BAY_RESOLVE_MCP`, then `<userData>/resolve-mcp`, then (unpackaged only) here, and
starts `venv/bin/python src/server.py` — the 36 compound tools — for a project whose host is
Resolve (`src/main/resolve/`).

What bay sets, and why:

- `DAVINCI_RESOLVE_MCP_UPDATE_CHECK=0` and `DAVINCI_RESOLVE_MCP_UPDATE_MODE=never`. Without them
  the server asks `api.github.com` for its latest release at startup
  (`src/utils/update_check.py`, `update_check_enabled`).
- `RESOLVE_SCRIPT_API`, `RESOLVE_SCRIPT_LIB`, `PYTHONPATH`: Blackmagic's scripting module.
- Not `DAVINCI_RESOLVE_BRIDGE`. Unset, the server tries outside scripting (Studio) and falls back
  to the in-Resolve bridge (the free edition) — `connect_resolve` in
  `src/utils/resolve_connection.py`.

What the connector does that bay's own sandbox does not govern — it is an ordinary process with
the user's permissions, and its tools take paths:

- With Resolve closed, the first tool call **launches Resolve** and waits up to 60 seconds
  (`get_resolve` in `src/server.py`). There is no switch for this short of forcing the bridge.
- It writes `logs/server.log` in its own folder, and state under `~/.config/davinci-resolve-mcp/`
  (the bridge's token and allowed folders: home for media, `~/Movies` for output).
- `media_analysis` can call a local Ollama (`127.0.0.1:11434`) and any HTTP transcription provider
  configured in its preferences, and the server can start its control panel, a loopback web
  server (`src/server.py`, read in the source, not exercised).
- The setup script's bridge installer writes into Resolve's `Fusion/Scripts/Utility` folders
  (the user's, and `/Library`'s when writable).
