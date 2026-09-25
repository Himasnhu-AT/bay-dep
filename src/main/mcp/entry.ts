/**
 * The `bay-mcp` entry point — what an MCP client spawns.
 *
 * Its own bundle rather than part of the main process, and run as plain Node rather than as
 * Electron, because stdio JSON-RPC needs a byte-exact stream and Chromium writes to stdout
 * whenever it likes. See `./proxy.ts` for the measurement behind that.
 *
 * Configured in an MCP client as:
 *
 *     command: /Applications/bay.app/Contents/MacOS/bay
 *     args:    ["<resources>/app.asar/out/main/mcp/index.js"]
 *     env:     { ELECTRON_RUN_AS_NODE: "1" }
 *
 * or, in a checkout, `node out/main/mcp/index.js` — which is what this repo's `.mcp.json` does.
 * The app binary doubles as the Node runtime, so nothing extra is installed and there is no npm
 * package to publish.
 *
 * The path is `out/main/mcp/index.js`, not `out/mcp/index.js`: the bundle lives under `main/`
 * because `src/mcp/` would have been outside every tsconfig and so outside the only gate main
 * -process code has. This comment said the shorter path for a while, which is worth more than
 * a typo — a configuration doc is copied verbatim into a file on a user's machine, and the
 * failure is a client that silently lists no tools.
 *
 * `BAY_MCP_SOCKET` overrides the socket path, which is what the end-to-end test uses to point
 * a real proxy at a real server without an app.
 *
 * `BAY_MCP_MODE=gateway` publishes three tools instead of the whole catalog — for a client that
 * puts every tool schema into every context and does no tool search:
 *
 *     get_active_project   what is open: name, canvas, fps, track and item counts, and whether
 *                          bay is reachable at all
 *     get_guidelines       the whole catalog as compact text — every operation, its purpose and
 *                          its argument schema — plus the guides to read first
 *     execute              { tool, args } — runs any catalog operation by the same path a direct
 *                          call takes: the same validation, errors, approval gate, `@./file`
 *                          arguments and image content
 *
 *     env: { ELECTRON_RUN_AS_NODE: "1", BAY_MCP_MODE: "gateway" }
 *
 * Unset (or `full`) is the default and publishes every tool. An unrecognised value falls back to
 * `full` with a warning on stderr. bay's own agent panel pins `full`, because it allows the agent
 * tools by name and a gateway would leave it none — see `bayMcpServer` in `../agent/cli.ts`.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { TOOL_MODE_ENV, toolModeFromEnv } from './protocol'
import { launchBay, runProxy } from './proxy'
import { SOCKET_NAME } from './socket-path'

/**
 * Where the app puts its socket, derived the same way Electron derives `userData`.
 *
 * Duplicated rather than imported because importing `electron` here would pull the whole
 * runtime into a bundle whose entire point is not to be Electron. The app name is the join
 * between the two and is asserted against `app.getName()` in the test.
 */
function defaultSocketPath(): string {
  const override = process.env['BAY_MCP_SOCKET']
  if (override) return override
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'bay', SOCKET_NAME)
  }
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, 'bay', SOCKET_NAME)
  }
  const configHome = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config')
  return join(configHome, 'bay', SOCKET_NAME)
}

/**
 * The app binary to launch. `process.execPath` is already it when the proxy runs through
 * `ELECTRON_RUN_AS_NODE`, which is the packaged case; `BAY_APP` covers a checkout where the
 * proxy runs under a plain `node` that is not bay.
 */
function appBinary(): string {
  return process.env['BAY_APP'] ?? process.execPath
}

const { mode, warning } = toolModeFromEnv(process.env[TOOL_MODE_ENV])
if (warning) process.stderr.write(`[bay-mcp] ${warning}\n`)

await runProxy({ socketPath: defaultSocketPath(), launch: launchBay(appBinary()), mode })
// The client has gone (see `runProxy`). Exit now rather than when the last timer or socket lets
// the event loop drain — a launch wait alone would hold it for thirty seconds.
process.exit(0)
