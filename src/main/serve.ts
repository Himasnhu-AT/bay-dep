/**
 * Serving a local file over `bay://`, as a pure request/response function.
 *
 * This is split from `protocol.ts` for one reason: none of it needs Electron. Range maths,
 * CORS headers, MIME types and URL decoding are all decisions about bytes, and keeping them
 * reachable without an app instance is what lets `serve.test.ts` drive real `Request` objects
 * at them. Range handling is exactly the kind of thing a later refactor breaks silently —
 * seeking still "works" for the first few seconds of every clip — so it needs a test that
 * runs, not a comment saying it was checked once.
 *
 * `protocol.ts` keeps the parts that genuinely are Electron: scheme registration and the
 * allowlist, which is handed in here as a predicate.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, resolve as resolvePath, sep } from 'node:path'
import { Readable } from 'node:stream'

export const BAY_SCHEME = 'bay'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

/** `bay://media/<base64url of the absolute path>`. Mirrored by `assetUrl()` in the engine. */
export function mediaUrl(absolutePath: string): string {
  return `${BAY_SCHEME}://media/${Buffer.from(absolutePath, 'utf8').toString('base64url')}`
}

export function decodeMediaUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.host !== 'media') return null
  const encoded = parsed.pathname.replace(/^\//, '')
  if (!encoded) return null
  try {
    const decoded = Buffer.from(decodeURIComponent(encoded), 'base64url').toString('utf8')
    // `resolve` collapses any `..` the encoding might have smuggled through before the
    // allowlist predicate sees the path, so the check cannot be walked around.
    return decoded ? resolvePath(decoded) : null
  } catch {
    return null
  }
}

/** `bytes=0-1023`, `bytes=500-`, `bytes=-500`. Returns null for anything else. */
export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === undefined || rawEnd === undefined) return null
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number
  if (rawStart === '') {
    // Suffix form: the last N bytes.
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return null
    start = Math.max(0, size - length)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    if (end > size - 1) end = size - 1
  }
  if (start > end || start < 0 || start >= size) return null
  return { start, end }
}

/**
 * Neither of these headers is optional, and the way each one fails is why they get a comment.
 *
 * `bay://` is a different origin from the renderer document, so a `<video>` or `<img>` loaded
 * from it taints any canvas it is drawn into and `getImageData` throws `SecurityError`.
 * Export composites to a canvas and reads it back — so without `allow-origin`, every frame
 * looks perfect on screen and the export dies at the readback, about as far from the cause as
 * a failure can land. The engine sets `crossOrigin = 'anonymous'` on every pooled element,
 * which turns tainting into an outright load failure unless this header is present.
 *
 * `expose-headers` is the second half, and it fails as the *same symptom from a different
 * cause*: a CORS response hides `content-range` and `accept-ranges` from the page unless they
 * are named, and a media element that cannot read them treats the source as unseekable —
 * indistinguishable from not supporting Range at all. Fixing one and not the other looks like
 * the fix did not work.
 */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges, content-type'
}

/** Errors carry CORS too: a blocked error response reaches `onerror` with no status at all. */
function headers(extra: Record<string, string>): Record<string, string> {
  return { ...CORS_HEADERS, ...extra }
}

function bodyFor(path: string, start: number, end: number): ReadableStream<Uint8Array> {
  const stream = createReadStream(path, { start, end })
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>
}

/**
 * The `bay://` allowlist rule: an exact admitted file, or anything under `root` (bay's cache).
 * The path is resolved first, whoever calls: `serveFile` already hands over a resolved path, but
 * `isAllowed` is also asked by generation about a reference path the agent named, and
 * `<root>/../secret.png` passes a raw prefix check.
 */
export function allowedBy(allowed: ReadonlySet<string>, root: string, path: string): boolean {
  const p = resolvePath(path)
  if (allowed.has(p)) return true
  return p === root || p.startsWith(root + sep)
}

/**
 * Answers one `bay://` request. `isAllowed` is the allowlist predicate — injected so this
 * function needs neither Electron nor a userData directory to run.
 */
export async function serveFile(
  request: Request,
  isAllowed: (path: string) => boolean
): Promise<Response> {
  // Chromium does not preflight a media element's range requests, but `fetch()` from the
  // renderer will preflight anything carrying a Range header. Answering is cheaper than
  // discovering later that one call site is the exception.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: headers({
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'range, content-type',
        'access-control-max-age': '86400'
      })
    })
  }

  const path = decodeMediaUrl(request.url)
  if (!path) return new Response('bad bay:// url', { status: 400, headers: headers({}) })
  if (!isAllowed(path)) return new Response('not permitted', { status: 403, headers: headers({}) })

  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return new Response('not a file', { status: 404, headers: headers({}) })
    size = info.size
  } catch {
    return new Response('not found', { status: 404, headers: headers({}) })
  }

  const type = mimeFor(path)
  const rangeHeader = request.headers.get('range')

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: headers({
        'content-type': type,
        'content-length': String(size),
        'accept-ranges': 'bytes'
      })
    })
  }

  if (rangeHeader) {
    const range = parseRange(rangeHeader, size)
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: headers({ 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' })
      })
    }
    return new Response(bodyFor(path, range.start, range.end), {
      status: 206,
      headers: headers({
        'content-type': type,
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache'
      })
    })
  }

  // Chromium only asks for ranges once it knows the server supports them, and it learns that
  // from `accept-ranges` on the first, unranged response. Omitting it here is the other half
  // of the broken-seeking failure.
  return new Response(size === 0 ? null : bodyFor(path, 0, size - 1), {
    status: 200,
    headers: headers({
      'content-type': type,
      'content-length': String(size),
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache'
    })
  })
}

/**
 * Whether a path a `.bay` file names may be served to the editor. A project is a document
 * someone may have sent you, and every asset path in it is admitted to `bay://` on open — so one
 * listing `~/.ssh/id_rsa` as a "video" would make that file readable by the page. Media never
 * needs a hidden file or a hidden folder, so any path segment starting with a dot is refused;
 * the clip then shows as offline instead of the file being served. Media the user imports
 * through a dialog or a drop is admitted directly and is not subject to this.
 */
export function admissibleFromProject(path: string): boolean {
  if (!isAbsolute(path)) return false
  return !path.split(/[\\/]/).some((segment) => segment.startsWith('.'))
}
