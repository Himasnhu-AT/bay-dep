/**
 * The `bay://` scheme — how the renderer reads user media without `webSecurity: false`.
 *
 * What is left here is only the part that needs Electron: registering the scheme, and the
 * allowlist, which is the security boundary. The scheme is reachable from any page the
 * renderer loads, so it maps only paths the user actually imported (plus bay's own cache) —
 * without that, a `bay://` URL is an arbitrary-file-read primitive handed to the web layer.
 *
 * Everything about turning a request into bytes lives in `serve.ts`, which imports no
 * Electron and is covered by `serve.test.ts`.
 */

import { protocol } from 'electron'
import { resolve as resolvePath, sep } from 'node:path'
import { cacheDir } from './paths'
import { BAY_SCHEME, serveFile } from './serve'

export { BAY_SCHEME, mediaUrl } from './serve'

/**
 * Must run before `app.whenReady()`. Electron reads the privileged-scheme table once during
 * startup; registering later is accepted and then quietly ignored.
 *
 * `corsEnabled` makes the scheme *participate* in CORS — it does not add the header. The
 * `access-control-allow-origin` that keeps the export canvas untainted is sent per response
 * in `serve.ts`; both halves are required.
 */
export function registerBayScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: BAY_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true
      }
    }
  ])
}

const allowed = new Set<string>()

/** Adds a file to the set the renderer may read. Import and project-open both call this. */
export function allowPath(p: string): void {
  if (!p) return
  allowed.add(resolvePath(p))
}

export function allowPaths(paths: readonly (string | null | undefined)[]): void {
  for (const p of paths) if (p) allowPath(p)
}

export function isAllowed(p: string): boolean {
  if (allowed.has(p)) return true
  // Cache entries are bay's own output — posters, filmstrip frames — and are served by the
  // same scheme, so the directory is allowed as a whole rather than file by file.
  const cache = cacheDir()
  return p === cache || p.startsWith(cache + sep)
}

export function registerBayProtocolHandler(): void {
  protocol.handle(BAY_SCHEME, (request) => serveFile(request, isAllowed))
}
