/**
 * Where the socket lives, and what the proxy is spawned as.
 *
 * Both are **compatibility surfaces the moment anyone configures an MCP client**: the command
 * goes into a config file on the user's machine and stays there across upgrades. They are
 * pinned as literals in `socket-path.test.ts` for the same reason `LAST_PROJECT_KEY` is —
 * changing either silently breaks every client already set up, and the failure is a tool that
 * simply never appears rather than an error anyone sees.
 *
 * Kept apart from the code that uses them so the constants can be asserted without importing
 * Electron.
 */

import { join } from 'node:path'

/** Socket filename inside the app's userData directory. */
export const SOCKET_NAME = 'bay-mcp.sock'

/** The argument that makes the app's binary run the MCP proxy instead of opening a window. */
export const PROXY_FLAG = '--mcp'

/**
 * Unix sockets on macOS are limited to 104 bytes of path, and userData sits under a long
 * `~/Library/Application Support/...` prefix. It fits today with room to spare, but the
 * failure mode when it does not is an `EINVAL` from `listen` that names nothing useful, so
 * the check is explicit and says what to do.
 */
export const MAX_SOCKET_PATH = 104

export function socketPathIn(userDataDir: string): string {
  const path = join(userDataDir, SOCKET_NAME)
  if (path.length > MAX_SOCKET_PATH) {
    throw new Error(
      `The MCP socket path is ${path.length} bytes, over the ${MAX_SOCKET_PATH}-byte limit for ` +
        `unix sockets: ${path}. This happens when the app name or user directory is unusually ` +
        `long; a shorter app name is the only fix.`
    )
  }
  return path
}
