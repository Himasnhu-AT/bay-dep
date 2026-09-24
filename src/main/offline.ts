/**
 * The editor window's session reaches nothing outside the machine.
 *
 * The renderer's CSP already permits no remote origin, but a CSP binds a document, and a worker
 * the renderer starts from its own files does not inherit it — measured: inside one, `fetch` to a
 * remote origin reached the network. `.brf` modules run in exactly such workers. So the rule is
 * enforced where no script can reach it: the session cancels every request that is not local.
 *
 * Main's own traffic — the whisper model download — uses Node's `fetch`, not this session, and
 * is unaffected. Composition windows have their own partition with their own filter
 * (`html/sandbox.ts`).
 */

/** Schemes that never leave the machine. */
const LOCAL_SCHEMES = new Set(['file:', 'bay:', 'data:', 'blob:', 'devtools:', 'chrome:', 'chrome-extension:', 'about:'])

/**
 * Whether the editor window may make this request. `devServer` is the Vite dev server in
 * development, whose own origin — pages, modules and the HMR socket — stays reachable, and only
 * when it is on this machine.
 */
export function isLocalRequest(url: string, devServer?: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (LOCAL_SCHEMES.has(parsed.protocol)) return true
  if (!devServer) return false
  let dev: URL
  try {
    dev = new URL(devServer)
  } catch {
    return false
  }
  const loopback = dev.hostname === 'localhost' || dev.hostname === '127.0.0.1' || dev.hostname === '[::1]'
  return loopback && ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) && parsed.host === dev.host
}
