# Installing bay for agents

The release bundles the CLI and this skill. After installing `bay.app`:

```bash
/Applications/bay.app/Contents/Resources/install-agent-tools
```

That links `bay` into `~/.local/bin` and installs the skill for Claude Code, Cursor, and
OpenClaw. Pass `--client claude`, `--client cursor`, or `--client openclaw` to select registries.

The HTTP MCP endpoint requires a bearer token. bay generates it at
`~/Library/Application Support/bay/mcp-token` with user-only permissions and never prints its
value:

```bash
export BAY_MCP_TOKEN="$(<"$HOME/Library/Application Support/bay/mcp-token")"
claude mcp add --transport http bay http://127.0.0.1:7333/mcp \
  --header "Authorization: Bearer $BAY_MCP_TOKEN"
```

Cursor and OpenClaw should supply the same `Authorization` header through their secret or
environment-variable configuration. Never commit the token. Restart the MCP client after
registration.
