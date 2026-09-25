/**
 * `BAY_GENERATION_BASE`: points every provider at a stub on this Mac, so the in-app generate path
 * can be run end to end without a real key or a paid call. Electron-free, so it is unit-tested.
 *
 * Honoured only when both hold, and ignored (with the reason logged) otherwise:
 * - **the app is unpackaged** — a checkout's `electron .`, like `BAY_ACCESS=dev`. An installed
 *   bay never sends a key anywhere but the provider's own hosts, whatever its environment says.
 * - **the host is literally loopback** — `127.0.0.1`, `[::1]` or `localhost`. No name is resolved,
 *   so nothing but this Mac can be named.
 *
 * When honoured, it replaces the provider's base URL *and* is the only host the fence admits for
 * that run — the real providers' hosts are not added beside it.
 */

import type { HostPolicy } from './http'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export type LocalBase =
  | { kind: 'none' }
  | { kind: 'local'; baseUrl: string; policy: HostPolicy }
  | { kind: 'ignored'; reason: string }

export function localGenerationBase(isPackaged: boolean, env: Record<string, string | undefined>): LocalBase {
  const value = env['BAY_GENERATION_BASE']
  if (!value) return { kind: 'none' }
  if (isPackaged) return { kind: 'ignored', reason: 'BAY_GENERATION_BASE is ignored in an installed bay; generation uses the providers.' }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { kind: 'ignored', reason: `BAY_GENERATION_BASE is not a URL: ${value}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'ignored', reason: `BAY_GENERATION_BASE must be http(s): ${value}` }
  }
  const host = parsed.hostname.toLowerCase()
  if (!LOOPBACK.has(host)) {
    return { kind: 'ignored', reason: `BAY_GENERATION_BASE must be a stub on this Mac (http://127.0.0.1:<port>), not ${parsed.host}.` }
  }
  return {
    kind: 'local',
    baseUrl: parsed.origin,
    policy: { apiHosts: [host], downloadHosts: [host], insecureHosts: [host] }
  }
}
