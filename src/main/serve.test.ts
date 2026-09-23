/**
 * Tests for the `bay://` file server.
 *
 * These exist because both of the things they cover fail *quietly*. Broken Range handling
 * still plays the first few seconds of every clip, so it reads as "seeking feels sticky"
 * rather than as a bug. A missing CORS header does not break anything visible at all — it
 * breaks `getImageData` at export readback, long after every frame looked right on screen.
 * Neither would be caught by using the app for five minutes, which is exactly why a later
 * refactor can break them without anyone noticing.
 *
 * Every assertion here has been checked against a deliberate regression — the header removed,
 * the Range branch bypassed, the allowlist disabled, the path normalisation deleted — and
 * confirmed to fail. A test that stays green against the bug it guards is worse than no test,
 * because it is also a claim that the bug cannot happen.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/serve.test.ts
 *
 * Node strips the types natively, so this needs no test framework and no new dependency.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { admissibleFromProject, mediaUrl, parseRange, serveFile } from './serve'

const SIZE = 1000

const dir = mkdtempSync(join(tmpdir(), 'bay-serve-'))
const clip = join(dir, 'clip.mp4')
writeFileSync(clip, Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 256)))
const offLimits = join(dir, 'secret.txt')
writeFileSync(offLimits, 'nope')
const subdir = join(dir, 'folder')
mkdirSync(subdir)

const allow = (p: string): boolean => p === clip || p === subdir

async function get(url: string, init?: RequestInit): Promise<Response> {
  return serveFile(new Request(url, init), allow)
}

async function bodyBytes(response: Response): Promise<number> {
  if (!response.body) return 0
  return (await response.arrayBuffer()).byteLength
}

// ---------------------------------------------------------------------------
// Range parsing
// ---------------------------------------------------------------------------

test('parseRange reads the three legal forms', () => {
  assert.deepEqual(parseRange('bytes=0-499', SIZE), { start: 0, end: 499 })
  assert.deepEqual(parseRange('bytes=500-', SIZE), { start: 500, end: 999 })
  assert.deepEqual(parseRange('bytes=-200', SIZE), { start: 800, end: 999 })
})

test('parseRange clamps an end past the file and keeps single-byte ranges', () => {
  assert.deepEqual(parseRange('bytes=0-99999', SIZE), { start: 0, end: 999 })
  assert.deepEqual(parseRange('bytes=0-0', SIZE), { start: 0, end: 0 })
  assert.deepEqual(parseRange('bytes=999-999', SIZE), { start: 999, end: 999 })
})

test('parseRange rejects what it cannot answer', () => {
  // A start at or past the end is unsatisfiable, not a whole-file request.
  assert.equal(parseRange('bytes=1000-', SIZE), null)
  assert.equal(parseRange('bytes=-0', SIZE), null)
  assert.equal(parseRange('bytes=abc', SIZE), null)
  assert.equal(parseRange('bytes=-', SIZE), null)
  assert.equal(parseRange('', SIZE), null)
  assert.equal(parseRange(null, SIZE), null)
  // An empty file can satisfy no range at all.
  assert.equal(parseRange('bytes=0-', 0), null)
})

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

test('a plain GET returns the whole file and advertises Range support', async () => {
  const response = await get(mediaUrl(clip))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), String(SIZE))
  assert.equal(response.headers.get('content-type'), 'video/mp4')
  // Chromium only starts issuing ranged requests once it has seen this on an unranged
  // response. Without it the element never seeks, however good the 206 path is.
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(await bodyBytes(response), SIZE)
})

test('a ranged GET returns exactly that window as a 206', async () => {
  const response = await get(mediaUrl(clip), { headers: { range: 'bytes=100-199' } })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 100-199/${SIZE}`)
  assert.equal(response.headers.get('content-length'), '100')
  assert.equal(await bodyBytes(response), 100)
})

test('a suffix range returns the tail of the file', async () => {
  const response = await get(mediaUrl(clip), { headers: { range: 'bytes=-50' } })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 950-999/${SIZE}`)
  assert.equal(await bodyBytes(response), 50)
})

test('an unsatisfiable range is a 416 that names the real size', async () => {
  const response = await get(mediaUrl(clip), { headers: { range: 'bytes=5000-' } })
  assert.equal(response.status, 416)
  assert.equal(response.headers.get('content-range'), `bytes */${SIZE}`)
  assert.equal(await bodyBytes(response), 0)
})

test('HEAD reports the size without sending a body', async () => {
  const response = await get(mediaUrl(clip), { method: 'HEAD' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), String(SIZE))
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(await bodyBytes(response), 0)
})

test('OPTIONS preflights a ranged fetch', async () => {
  const response = await get(mediaUrl(clip), { method: 'OPTIONS' })
  assert.equal(response.status, 204)
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /range/)
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /GET/)
})

// ---------------------------------------------------------------------------
// CORS — the export path depends on every one of these
// ---------------------------------------------------------------------------

test('every response carries the headers that keep the export canvas untainted', async () => {
  const responses = await Promise.all([
    get(mediaUrl(clip)),
    get(mediaUrl(clip), { headers: { range: 'bytes=100-199' } }),
    get(mediaUrl(clip), { headers: { range: 'bytes=5000-' } }),
    get(mediaUrl(clip), { method: 'HEAD' }),
    get(mediaUrl(clip), { method: 'OPTIONS' }),
    get(mediaUrl(offLimits)),
    get(mediaUrl(join(dir, 'missing.mp4'))),
    get('bay://media/not-a-path?')
  ])

  for (const response of responses) {
    // Errors included: a CORS-blocked error response reaches the renderer's `onerror` with
    // no status, so a 403 becomes indistinguishable from the network dropping.
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      '*',
      `missing ACAO on ${response.status}`
    )
    const exposed = response.headers.get('access-control-expose-headers') ?? ''
    // Without these named, a CORS response hides them from the page and a media element
    // treats the source as unseekable — the same symptom as no Range support at all.
    assert.match(exposed, /content-range/, `content-range not exposed on ${response.status}`)
    assert.match(exposed, /accept-ranges/, `accept-ranges not exposed on ${response.status}`)
  }
})

// ---------------------------------------------------------------------------
// The allowlist is the security boundary
// ---------------------------------------------------------------------------

test('a path outside the allowlist is refused', async () => {
  const response = await get(mediaUrl(offLimits))
  assert.equal(response.status, 403)
})

test('a traversal cannot walk out of a directory-prefix allowlist', async () => {
  // This mirrors the rule that actually exists in protocol.ts: bay's cache directory is
  // allowed as a whole, by prefix. A prefix check is walkable — `<dir>/../secret.txt` really
  // does start with `<dir>/` — so the path has to be normalised *before* the check runs.
  //
  // Built by concatenation, deliberately not by `path.join`: join normalises its result, so
  // a test written that way hands the code an already-clean path and passes even when the
  // normalisation it is meant to guard has been deleted. Verified by removing `resolvePath`
  // from `decodeMediaUrl` and watching this fail.
  const underPrefix = (p: string): boolean => p === subdir || p.startsWith(subdir + sep)
  const escape = `${subdir}${sep}..${sep}secret.txt`
  assert.ok(
    underPrefix(escape),
    'the raw specimen must beat a naive prefix check, or this test proves nothing'
  )

  const response = await serveFile(new Request(mediaUrl(escape)), underPrefix)
  assert.equal(response.status, 403)
})

test('an allowed path that is a directory is not served as a file', async () => {
  const response = await get(mediaUrl(subdir))
  assert.equal(response.status, 404)
})

test('an allowed path that does not exist is a 404, not a crash', async () => {
  const missing = join(dir, 'gone.mp4')
  const response = await serveFile(new Request(mediaUrl(missing)), (p) => p === missing)
  assert.equal(response.status, 404)
})

test('a malformed bay:// url is a 400', async () => {
  const response = await get('bay://media/')
  assert.equal(response.status, 400)
})

test('a host other than media is refused', async () => {
  const response = await get(`bay://other/${Buffer.from(clip).toString('base64url')}`)
  assert.equal(response.status, 400)
})

// ---------------------------------------------------------------------------
// The URL contract with the renderer
// ---------------------------------------------------------------------------

test('mediaUrl round-trips a path with spaces and non-ASCII characters', async () => {
  const awkward = join(dir, 'My Clips — a+b (1).mp4')
  writeFileSync(awkward, 'x')
  const response = await serveFile(new Request(mediaUrl(awkward)), (p) => p === awkward)
  assert.equal(response.status, 200)
  assert.equal(await bodyBytes(response), 1)
})

test('mediaUrl matches the base64url the renderer engine builds', () => {
  // `assetUrl()` in src/renderer/src/engine/mediaPool.ts encodes the same way: UTF-8 bytes,
  // base64, +/ swapped for -_, padding stripped. If these ever diverge, every clip 400s.
  const path = '/Users/x/Vidéos/a+b/c.mp4'
  const expected = Buffer.from(path, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  assert.equal(mediaUrl(path), `bay://media/${expected}`)
})

test('a project file cannot admit hidden files or folders to bay://; ordinary media can be', () => {
  // Positive controls first: the paths real projects hold.
  assert.equal(admissibleFromProject('/Users/me/Movies/interview.mp4'), true)
  assert.equal(admissibleFromProject('/Users/me/Projects/Launch v2/title.html'), true)
  assert.equal(admissibleFromProject('/Users/me/Movies/take.1.final.mov'), true, 'dots inside a name are fine')
  // What a hostile .bay would list as "media".
  assert.equal(admissibleFromProject('/Users/me/.ssh/id_rsa'), false)
  assert.equal(admissibleFromProject('/Users/me/.aws/credentials'), false)
  assert.equal(admissibleFromProject('/Users/me/Movies/.env'), false)
  assert.equal(admissibleFromProject('relative/clip.mp4'), false)
  const traversal = '/Users/me/Movies/' + '..' + '/.ssh/id_rsa'
  assert.ok(traversal.includes('/../'), 'specimen keeps its ..')
  assert.equal(admissibleFromProject(traversal), false)
})
