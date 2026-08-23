# Agent and CLI installation

The macOS application contains one executable for all modes: the editor, the headless MCP
server, and the command-line status commands. It also contains the reviewed bay agent skill.

After copying `bay.app` to `/Applications`, install both:

```bash
/Applications/bay.app/Contents/Resources/install-agent-tools
```

The installer:

- links `bay` into `~/.local/bin` (override with `--bin-dir`);
- copies the skill into `~/.claude/skills/bay`, `~/.cursor/skills/bay`, and
  `~/.openclaw/skills/bay`;
- accepts `--client claude`, `--client cursor`, or `--client openclaw` to install only selected
  registries; and
- refuses to replace a non-symlink CLI file.

From a source checkout, run `./script/install-agent-tools`; it uses the same skill directory
that is bundled into releases. `skills/bay` is a compatibility symlink to the canonical
`.claude/skills/bay`, so there is only one copy to regenerate and review.

## Authenticate the MCP client

HTTP MCP requests require `Authorization: Bearer <token>`. Loopback binding prevents remote
network access, but without a credential any local process—or an origin-less request created by
a browser exploit—could otherwise drive file-reading and file-writing editor tools.

On first HTTP start, bay creates a random 256-bit token with user-only permissions:

- macOS: `~/Library/Application Support/bay/mcp-token`
- Windows: `%LOCALAPPDATA%\bay\mcp-token`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/bay/mcp-token`

`BAY_DATA_DIR` relocates this file with the rest of bay's private data. Alternatively, set
`BAY_MCP_TOKEN` to exactly 64 hexadecimal characters before starting bay; the client must use
the same value. bay prints the credential's location or environment-variable name, never its
value.

For Claude Code:

```bash
export BAY_MCP_TOKEN="$(<"$HOME/Library/Application Support/bay/mcp-token")"
claude mcp add --transport http bay http://127.0.0.1:7333/mcp \
  --header "Authorization: Bearer $BAY_MCP_TOKEN"
```

Use the equivalent secret/environment facility in Cursor or OpenClaw and configure the same
header. Do not put the token in a checked-in MCP configuration. MCP clients load tools at session
start, so restart the client after registration.

Stdio mode (`bay --stdio`) does not use HTTP authentication: the MCP client launches the process
and owns its private stdin/stdout pipes, so there is no listening port for another process to
reach.

## CLI

```bash
bay                 # open the editor
bay --mcp           # headless MCP server on 127.0.0.1:7333
bay --stdio         # MCP over private stdin/stdout
bay --agents        # report the current endpoint owner
bay --version
```

The CLI and desktop application are the same binary, preventing a separately packaged CLI from
drifting from the engine in the app.
