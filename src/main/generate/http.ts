/**
 * The only way generation code reaches the network: Node's `fetch`, fenced to one provider's
 * hosts.
 *
 * Same idea as `guardedFetch` in `auth/google.ts`, with two things that one does not need:
 *
 * - **Redirects are followed by hand.** A Veo result is a URL that redirects to Google's storage;
 *   letting `fetch` follow it would let any 3xx take bay anywhere. Each hop is checked against the
 *   allowlist before it is requested, and credentials (`Authorization`, `x-goog-api-key`, …) go
 *   only to the provider's API hosts — a hop to a download host is sent with no headers at all.
 * - **Downloads are capped.** The body is read in chunks and abandoned the moment it passes the
 *   cap, so a hostile or broken endpoint cannot fill the disk or the heap.
 *
 * Electron-free, so `http.test.ts` drives it against a local server. The one concession to that
 * is `insecureHosts`: tests name their stub's hosts there to allow plain http. It relaxes the
 * scheme only, never the host list. Production code passes none, and every production host is https.
 */

import { PROVIDERS, type GenerationProvider } from '@shared/generation'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface HostPolicy {
  /** Called with credentials. */
  apiHosts: readonly string[]
  /** May be downloaded from, or redirected to, without credentials. */
  downloadHosts: readonly string[]
  /** Tests only: hosts that may be reached over plain http. */
  insecureHosts?: readonly string[]
}

export interface ProviderHttp {
  /** A call to the API. Refuses any host outside `apiHosts`, on the first request or a redirect. */
  api(url: string, init?: RequestInit): Promise<Response>
  /** A result file, at most `maxBytes`. API or download hosts; credentials only on API hosts. */
  download(url: string, init: RequestInit | undefined, maxBytes: number): Promise<{ bytes: Buffer; contentType: string }>
}

const MAX_HOPS = 5

/** `.example.com` matches `a.example.com` (not `example.com`); anything else matches exactly. */
export function hostMatches(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase()
  return patterns.some((p) => (p.startsWith('.') ? h.endsWith(p.toLowerCase()) && h.length > p.length : h === p.toLowerCase()))
}

export function policyFor(provider: GenerationProvider, insecureHosts?: readonly string[]): HostPolicy {
  const spec = PROVIDERS[provider]
  return { apiHosts: spec.apiHosts, downloadHosts: spec.downloadHosts, ...(insecureHosts ? { insecureHosts } : {}) }
}

/** The host of `url` if the policy admits it for this use, or an error naming what it admits. */
function admit(url: string, allowed: readonly string[], policy: HostPolicy, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`bay refused to contact a malformed URL for ${label}.`)
  }
  const insecure = policy.insecureHosts ?? []
  const secure = parsed.protocol === 'https:'
  const allowedInsecure = parsed.protocol === 'http:' && hostMatches(parsed.hostname, insecure)
  if (!secure && !allowedInsecure) {
    throw new Error(`bay refused to contact ${parsed.host} for ${label}: only https is allowed.`)
  }
  if (!hostMatches(parsed.hostname, allowed)) {
    throw new Error(`bay refused to contact ${parsed.hostname} for ${label}: only ${allowed.join(', ') || 'no hosts'}.`)
  }
  return parsed
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function follow(
  inner: Fetch,
  policy: HostPolicy,
  label: string,
  url: string,
  init: RequestInit | undefined,
  allowed: readonly string[]
): Promise<Response> {
  let current = admit(url, allowed, policy, label)
  let request: RequestInit = { ...(init ?? {}) }
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const credentialed = hostMatches(current.hostname, policy.apiHosts)
    const response = await inner(current.toString(), {
      ...request,
      ...(credentialed ? {} : { headers: {} }),
      redirect: 'manual'
    })
    if (!isRedirect(response.status)) return response
    const location = response.headers.get('location')
    if (!location) return response
    // Drain the redirect's body so the connection can be reused.
    await response.arrayBuffer().catch(() => undefined)
    current = admit(new URL(location, current).toString(), allowed, policy, label)
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && request.method && request.method !== 'GET')) {
      const { body: _body, ...rest } = request
      request = { ...rest, method: 'GET' }
    }
  }
  throw new Error(`bay stopped following redirects for ${label} after ${MAX_HOPS} hops.`)
}

export function providerHttp(inner: Fetch, policy: HostPolicy, label: string): ProviderHttp {
  return {
    api: (url, init) => follow(inner, policy, label, url, init, policy.apiHosts),
    async download(url, init, maxBytes) {
      const response = await follow(inner, policy, label, url, init, [...policy.apiHosts, ...policy.downloadHosts])
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`${label} answered ${response.status} to the download${text ? `: ${text.slice(0, 300)}` : ''}.`)
      }
      const read = await readCapped(response, maxBytes)
      if (read.over === 'declared') {
        throw new Error(`${label}'s result is ${read.declared} bytes, over bay's ${maxBytes}-byte limit; it was not downloaded.`)
      }
      if (read.over === 'streamed') throw new Error(`${label}'s result passed bay's ${maxBytes}-byte limit; the download was abandoned.`)
      return { bytes: read.bytes, contentType: response.headers.get('content-type') ?? '' }
    }
  }
}

export type CappedRead = { over: null; bytes: Buffer } | { over: 'declared'; declared: number } | { over: 'streamed' }

/**
 * A response body, read in chunks and abandoned the moment it passes `maxBytes` — refused
 * unread when its declared length is already over. A body with no length, or one that lies about
 * it, costs at most `maxBytes` of memory, never the whole stream.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<CappedRead> {
  const declared = Number(response.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    return { over: 'declared', declared }
  }
  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { over: 'streamed' }
      }
      chunks.push(Buffer.from(value))
    }
  }
  return { over: null, bytes: Buffer.concat(chunks) }
}
