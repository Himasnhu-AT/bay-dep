/**
 * `import_url`: what counts as a web address bay will hand to yt-dlp, and the caps on a download.
 *
 * Shared because three places ask the same question and must not disagree: the renderer's handler
 * (a dry run answers without reaching main's downloader), main's policy (the in-app agent's
 * confirmation names the host), and main's downloader itself, which checks again rather than
 * trusting either — the address arrives from an agent, and text an agent read can carry an
 * injection.
 *
 * The check is about what yt-dlp would do with the string, not about URLs in general. yt-dlp reads
 * `file://` and local paths as happily as web addresses, and anything starting with `-` as an
 * option (`--exec`, `-o /etc/x`); so only `http:`/`https:` pass, with no whitespace or control
 * characters that could split one argument into several in some later layer. The argument list is
 * built as an array with `--` before the address as well — the check here is the first wall, not
 * the only one.
 */

/** 1080p is plenty for editing and keeps a download to minutes, not an hour. */
export const URL_IMPORT_MAX_HEIGHT = 1080
/**
 * The most a download's folder may hold, parts and fragments included. yt-dlp refuses up front a
 * file whose size it is told; bay measures the folder while it runs, because a chunked, HLS/DASH
 * or live stream announces no size and yt-dlp's own cap never fires on it.
 */
export const URL_IMPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** A download still running after this is killed and its folder removed. */
export const URL_IMPORT_TIMEOUT_MS = 15 * 60_000

/**
 * What main answers. A download lands at `path`, inside bay's downloads folder, not yet imported;
 * a dry run starts nothing and returns the exact argument list it would run.
 */
export type UrlImportResult =
  | { ok: true; path: string; ytDlp: string }
  | { ok: true; dryRun: true; ytDlp: string; args: string[] }
  | { ok: false; error: string }

export type CheckedUrl = { ok: true; url: string; host: string; query: string } | { ok: false; error: string }

export interface CheckOptions {
  /**
   * Tests only: admit loopback and private addresses, so the downloader's tests can run the real
   * yt-dlp against a server on 127.0.0.1. No tool, policy or IPC handler passes it.
   */
  allowPrivateHosts?: boolean
}

/** Four octets from a dotted IPv4 literal, or null. */
function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  return octets.every((o) => o <= 255) ? octets : null
}

function ipv4Reason(o: number[]): string | null {
  const [a = 0, b = 0] = o
  if (a === 0) return 'the "this network" range, 0.0.0.0/8'
  if (a === 127) return 'loopback, this Mac itself'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'a private network range'
  if (a === 169 && b === 254) return 'link-local'
  if (a === 100 && b >= 64 && b <= 127) return 'the carrier-grade NAT range, 100.64.0.0/10'
  if (a >= 224) return 'multicast or reserved'
  return null
}

/** Eight 16-bit groups from an IPv6 literal (brackets removed), or null. */
function ipv6(host: string): number[] | null {
  let text = host
  // A trailing dotted IPv4 (the URL parser rewrites it to hex, but read it either way).
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (dotted) {
    const v4 = ipv4(dotted[2]!)
    if (!v4) return null
    text = `${dotted[1]}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const part = (s: string): number[] | null => {
    if (s === '') return []
    const groups = s.split(':').map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN))
    return groups.some(Number.isNaN) ? null : groups
  }
  const head = part(halves[0]!)
  const tail = halves.length === 2 ? part(halves[1]!) : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const fill = 8 - head.length - tail.length
  return fill < 1 ? null : [...head, ...Array<number>(fill).fill(0), ...tail]
}

function ipv6Reason(g: number[]): string | null {
  const [first = 0] = g
  if (g.every((x) => x === 0)) return 'the unspecified address, ::'
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'loopback, this Mac itself'
  // An IPv4 address carried in IPv6 (::ffff:a.b.c.d, or the NAT64 prefix 64:ff9b::/96).
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff
  const nat64 = first === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)
  if (mapped || nat64) return ipv4Reason([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff])
  if ((first & 0xfe00) === 0xfc00) return 'a private (unique local) range, fc00::/7'
  if ((first & 0xffc0) === 0xfe80) return 'link-local, fe80::/10'
  if ((first & 0xff00) === 0xff00) return 'multicast'
  return null
}

/**
 * Why `hostname` (as the URL parser gives it: lower case, IPv4 canonical, IPv6 in brackets) is not
 * a public web host, or null. Literal addresses and `localhost` names only: a public name that
 * resolves to a private address is yt-dlp's to connect to, and bay does not resolve names first.
 */
export function privateHostReason(hostname: string): string | null {
  const host = hostname.replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return 'a name for this Mac itself'
  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = ipv6(host.slice(1, -1))
    return groups ? ipv6Reason(groups) : 'an IPv6 address bay cannot read'
  }
  const v4 = ipv4(host)
  return v4 ? ipv4Reason(v4) : null
}

/** A query this long, or one carrying another address, is worth a second look before agreeing. */
const LONG_QUERY = 100

/**
 * The confirmation the in-app agent's download puts in front of the user. The query string gets
 * a line of its own, because that is where an injected address carries out what the agent read,
 * and a warning when it holds another address or is long enough to hide one.
 */
export function downloadConfirmation(checked: { url: string; host: string; query: string }): { message: string; detail: string } {
  const lines = [`bay's agent wants to download:`, checked.url]
  if (checked.query) {
    lines.push('', `Query string (sent to ${checked.host}):`, checked.query)
    const embedded = /https?:\/\/|https?%3a|%2f%2f/i.test(checked.query)
    if (embedded || checked.query.length > LONG_QUERY) {
      lines.push(
        '',
        `Warning: this query string ${embedded ? 'contains another web address' : `is ${checked.query.length} characters long`}. ` +
          `A video page rarely needs that; it can carry text the agent read out to ${checked.host}. Download only if you expected this address.`
      )
    }
  }
  return { message: `Download a video from ${checked.host}?`, detail: lines.join('\n') }
}

export function checkDownloadUrl(raw: unknown, options: CheckOptions = {}): CheckedUrl {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'url is empty. Pass the page address of the video, starting with https://.' }
  }
  const given = raw.trim()
  if (given.length > 2048) return { ok: false, error: 'That address is over 2048 characters, which no video page needs. Pass the page address itself.' }
  // Whitespace and control characters: one "address" that is really an address plus options.
  if (/[\s\u0000-\u001f\u007f]/.test(given)) {
    return { ok: false, error: `"${given.slice(0, 80)}" contains spaces or control characters, so it is not one web address. Pass just the page address, starting with https://.` }
  }
  let parsed: URL
  try {
    parsed = new URL(given)
  } catch {
    return { ok: false, error: `"${given.slice(0, 80)}" is not a web address. Pass the page address of the video, starting with https://.` }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      error:
        `import_url downloads from web pages only (http or https), not ${parsed.protocol} addresses. ` +
        `For a file already on this Mac, use import_media with its path.`
    }
  }
  if (!parsed.hostname) return { ok: false, error: `"${given.slice(0, 80)}" names no website. Pass the full page address.` }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'That address carries a user name or password. bay does not send credentials; pass the address without them.' }
  }
  const local = options.allowPrivateHosts ? null : privateHostReason(parsed.hostname)
  if (local) {
    return {
      ok: false,
      error:
        `${parsed.hostname} is ${local}, not a public website. import_url downloads from public web pages only; ` +
        `for a file already on this Mac, use import_media with its path.`
    }
  }
  return { ok: true, url: parsed.href, host: parsed.hostname, query: parsed.search }
}
