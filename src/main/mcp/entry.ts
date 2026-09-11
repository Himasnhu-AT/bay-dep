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
 *     args:    ["<resources>/app.asar/out/mcp/index.js"]
 *     env:     { ELECTRON_RUN_AS_NODE: "1" }
 *
 * or, in a checkout, `node out/mcp/index.js`. The app binary doubles as the Node runtime, so
 * nothing extra is installed and there is no npm package to publish.
 *
 * `BAY_MCP_SOCKET` overrides the socket path, which is what the end-to-end test uses to point
 * a real proxy at a real server without an app.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
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

await runProxy({ socketPath: defaultSocketPath(), launch: launchBay(appBinary()) })
