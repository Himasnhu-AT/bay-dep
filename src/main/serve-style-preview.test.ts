/**
 * `bay://style-preview/<id>/<file>`: the styles' shipped preview media, and nothing else.
 *
 *   node --import ./src/test-hooks.mjs --test src/main/serve-style-preview.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { admitStylePreview, mediaUrl, serveBayRequest, stylePreviewPath } from './serve'

const dir = mkdtempSync(join(tmpdir(), 'bay-style-preview-'))
const root = join(dir, 'styles')
mkdirSync(join(root, 'demo-style'), { recursive: true })
writeFileSync(join(root, 'demo-style', 'poster.webp'), 'poster-bytes')
writeFileSync(join(root, 'demo-style', 'preview.webm'), 'loop-bytes')
writeFileSync(join(root, 'demo-style', 'notes.txt'), 'not media')
// Outside the styles folder, but named like preview media.
mkdirSync(join(dir, 'outside'), { recursive: true })
writeFileSync(join(dir, 'outside', 'poster.webp'), 'secret')

/** The check a careless version would make: anything under the folder. */
const naive = (path: string): boolean => path.startsWith(root + sep)

test('admits exactly <root>/<id>/preview.webm and poster.webp', () => {
  assert.equal(admitStylePreview(root, root + sep + 'demo-style' + sep + 'poster.webp'), true)
  assert.equal(admitStylePreview(root, root + sep + 'demo-style' + sep + 'preview.webm'), true)
  // A detour inside the folder is still the same file.
  assert.equal(admitStylePreview(root, root + sep + 'demo-style' + sep + '.' + sep + 'poster.webp'), true)

  // Everything else under the folder is refused, though a naive prefix check admits each one.
  for (const refused of [
    root + sep + 'demo-style' + sep + 'notes.txt',
    root + sep + 'demo-style',
    root + sep + 'poster.webp',
    root + sep + 'demo-style' + sep + 'deeper' + sep + 'poster.webp',
    root + sep + 'Demo_Style' + sep + 'poster.webp'
  ]) {
    assert.ok(naive(refused), `specimen ${refused} must beat the naive check`)
    assert.equal(admitStylePreview(root, refused), false, refused)
  }
  assert.equal(admitStylePreview(root, root), false)
  // A sibling sharing the folder's name as a prefix is not inside it.
  assert.equal(admitStylePreview(root, `${root}-other${sep}demo-style${sep}poster.webp`), false)
})

test('a traversal cannot walk out of the styles folder', () => {
  // Built by concatenation, not `join`, which would normalise the `..` away and hand the check an
  // already-clean path.
  const escape = root + sep + '..' + sep + 'outside' + sep + 'poster.webp'
  assert.ok(escape.includes(`${sep}..${sep}`), 'the specimen keeps its ..')
  assert.ok(naive(escape), 'the raw specimen must beat a naive prefix check, or this test proves nothing')
  assert.equal(admitStylePreview(root, escape), false)
  const detour = root + sep + 'demo-style' + sep + '..' + sep + '..' + sep + 'outside' + sep + 'poster.webp'
  assert.ok(naive(detour))
  assert.equal(admitStylePreview(root, detour), false)
})

test('style-preview URLs map to the admitted file, and encoded traversal is refused', () => {
  assert.equal(stylePreviewPath(root, 'bay://style-preview/demo-style/poster.webp'), join(root, 'demo-style', 'poster.webp'))
  assert.equal(stylePreviewPath(root, 'bay://style-preview/demo-style/preview.webm'), join(root, 'demo-style', 'preview.webm'))
  for (const url of [
    // The URL parser collapses a plain `..`; encoded slashes survive it.
    'bay://style-preview/..%2Foutside/poster.webp',
    'bay://style-preview/%2E%2E%2F%2E%2E%2Foutside/poster.webp',
    'bay://style-preview/demo-style/..%2F..%2Foutside%2Fposter.webp',
    'bay://style-preview/demo-style/notes.txt',
    'bay://style-preview/demo-style',
    'bay://style-preview/',
    'bay://media/demo-style/poster.webp',
    'https://style-preview/demo-style/poster.webp',
    'bay://style-preview/demo-style/%E0%A4%A.webm'
  ]) {
    assert.equal(stylePreviewPath(root, url), null, url)
  }
})

test('serveBayRequest answers a preview from the styles folder and nothing else', async () => {
  const noMedia = (): boolean => false
  const ok = await serveBayRequest(new Request('bay://style-preview/demo-style/poster.webp'), noMedia, root)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'image/webp')
  assert.equal(await ok.text(), 'poster-bytes')

  const loop = await serveBayRequest(new Request('bay://style-preview/demo-style/preview.webm', { headers: { range: 'bytes=0-3' } }), noMedia, root)
  assert.equal(loop.status, 206)
  assert.equal(loop.headers.get('content-type'), 'video/webm')

  // A missing preview is a 404 the tile can fall back from, not a crash.
  const missing = await serveBayRequest(new Request('bay://style-preview/other-style/poster.webp'), noMedia, root)
  assert.equal(missing.status, 404)

  // Encoded traversal never reaches the file outside, even with a media allowlist that admits it.
  const outside = join(dir, 'outside', 'poster.webp')
  const admitsOutside = (p: string): boolean => p === outside
  const escaped = await serveBayRequest(new Request('bay://style-preview/..%2Foutside/poster.webp'), admitsOutside, root)
  assert.notEqual(escaped.status, 200)
  // Positive control: that file is reachable as media when the media allowlist admits it.
  const asMedia = await serveBayRequest(new Request(mediaUrl(outside)), admitsOutside, root)
  assert.equal(asMedia.status, 200)
  // And the styles folder is not reachable as media unless the media allowlist says so.
  const styleAsMedia = await serveBayRequest(new Request(mediaUrl(join(root, 'demo-style', 'poster.webp'))), noMedia, root)
  assert.equal(styleAsMedia.status, 403)
})
