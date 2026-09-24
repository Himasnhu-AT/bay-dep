/**
 * Where the socket lives, and what the proxy is spawned as.
 *
 * The socket name is a **compatibility surface the moment anyone configures an MCP client**:
 * the command goes into a config file on the user's machine and stays there across upgrades.
 * It is pinned as a literal in the tests for the same reason `LAST_PROJECT_KEY` is — changing
 * it silently breaks every client already set up, and the failure is a tool that never appears
 * rather than an error anyone sees.
 *
 * **There is deliberately no `--mcp` flag.** There was a `PROXY_FLAG = '--mcp'` here, pinned
 * as a compatibility surface and used by nothing — the exact "looks wired, does nothing" shape
 * this codebase keeps finding. It went rather than getting an implementation, because the
 * thing it implies cannot be delivered: serving stdio JSON-RPC from `bay --mcp` would put the
 * stream in the hands of the Electron *main* process, which means booting Chromium and a
 * second full app instance for a job that is relaying bytes — and Chromium writes to stdout on
 * its own schedule, which is the disqualifying property the proxy exists to avoid. The
 * supported command is the app binary run as plain Node against `out/main/mcp/index.js`, which
 * is measured clean and tested end to end.
 *
 * Kept apart from the code that uses it so the constant can be asserted without importing
 * Electron.
 */

import { join } from 'node:path'

/** Socket filename inside the app's userData directory. */
export const SOCKET_NAME = 'bay-mcp.sock'

/**
 * Unix sockets on macOS are limited to 104 bytes of path, and userData sits under a long
 * `~/Library/Application Support/...` prefix. It fits today with room to spare, but the
 * failure mode when it does not is an `EINVAL` from `listen` that names nothing useful, so
 * the check is explicit and says what to do.
 */
export const MAX_SOCKET_PATH = 104

/**
 * The in-app agent's own socket. A separate file rather than a flag in the call, because which
 * kind of caller it is has to be a property of the connection — a call cannot claim it.
 */
export const AGENT_SOCKET_NAME = 'bay-agent.sock'

export function socketPathIn(userDataDir: string, name: string = SOCKET_NAME): string {
  const path = join(userDataDir, name)
  if (path.length > MAX_SOCKET_PATH) {
    throw new Error(
      `The MCP socket path is ${path.length} bytes, over the ${MAX_SOCKET_PATH}-byte limit for ` +
        `unix sockets: ${path}. This happens when the app name or user directory is unusually ` +
        `long; a shorter app name is the only fix.`
    )
  }
  return path
}
