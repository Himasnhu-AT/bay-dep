/**
 * Importing a font file: bay's own copy, content-addressed, and an asset that still resolves when
 * the original is gone — which is what "the project keeps its fonts" means. Plus the composition
 * side: only files in bay's fonts folder are ever inlined into a composition, whatever the request
 * names, and the inlined bytes are the file's.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importFontFile } from './font-import'
import { compositionFontCss } from '../html/font-css'
import { importedFamilies, importedFonts } from '@shared/fonts'

const ARCHIVO = '/Users/himanshu/codes/dodle/studio/video/assets/fonts/Archivo[wdth,wght].ttf'
const skip = existsSync(ARCHIVO) ? false : `no Archivo at ${ARCHIVO}`

test('a font imports as bay\'s own copy, and still resolves once the original is gone', { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'bay-fonts-'))
  const fonts = join(root, 'fonts')
  mkdirSync(fonts)
  // A copy of the read-only original that this test may delete.
  const original = join(root, 'Archivo[wdth,wght].ttf')
  writeFileSync(original, readFileSync(ARCHIVO))

  const asset = await importFontFile(original, fonts)
  assert.equal(asset.error, undefined, asset.error)
  assert.equal(asset.kind, 'font')
  assert.equal(asset.name, 'Archivo[wdth,wght].ttf')
  assert.ok(asset.path?.startsWith(fonts + '/'), `served from bay's folder, not the original: ${asset.path}`)
  assert.equal(asset.font?.family, 'Archivo')
  assert.equal(asset.font?.importedFrom, original)
  assert.deepEqual(importedFamilies([asset]), ['Archivo'])

  await rm(original)
  assert.ok(existsSync(asset.path!), 'the copy outlives the original')
  assert.deepEqual(new Uint8Array(await readFile(asset.path!)), new Uint8Array(readFileSync(ARCHIVO)))

  // Content-addressed: the same bytes from another path are the same file, not a second copy.
  const again = join(root, 'elsewhere.ttf')
  writeFileSync(again, readFileSync(ARCHIVO))
  assert.equal((await importFontFile(again, fonts)).path, asset.path)
})

test('a file named like a font that is not one imports as an error, beside one that is', { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'bay-fonts-'))
  const fake = join(root, 'fake.woff2')
  writeFileSync(fake, 'this is plainly not a font file at all')
  const bad = await importFontFile(fake, root)
  assert.match(bad.error ?? '', /is not a font bay can read: .*WOFF2/)
  assert.deepEqual(importedFonts([bad]), [], 'an unreadable font is never registered')
  const good = await importFontFile(ARCHIVO, root)
  assert.equal(good.error, undefined)
})

test('a composition is given only fonts from bay\'s folder, inlined byte for byte', { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'bay-fonts-'))
  const fonts = join(root, 'fonts')
  mkdirSync(fonts)
  const asset = await importFontFile(ARCHIVO, fonts)
  const face = { family: 'Archivo', path: asset.path!, weight: '100 900', stretch: '62% 125%', style: 'normal', format: 'truetype' as const }

  // A sibling folder whose name starts with the fonts folder's: a naive prefix check admits it.
  const evil = join(root, 'fonts-evil')
  mkdirSync(evil)
  const outside = join(evil, 'x.ttf')
  writeFileSync(outside, readFileSync(ARCHIVO))
  assert.ok(outside.startsWith(fonts), 'specimen: defeats a prefix check without a separator')

  const sheet = await compositionFontCss([face, { ...face, path: outside }, { ...face, weight: '400; } body { background: red' }], fonts, (p) => readFile(p))
  assert.deepEqual(sheet.families, ['Archivo'])
  assert.deepEqual(sheet.refused.map((r) => r.reason), ["it is not in bay's fonts folder", 'its descriptors are not ones bay writes'])
  assert.ok(!sheet.css.includes('background: red'), 'no descriptor can write CSS of its own')
  assert.equal((sheet.css.match(/@font-face/g) ?? []).length, 1)
  const data = /base64,([^"]+)"/.exec(sheet.css)?.[1] ?? ''
  assert.deepEqual(new Uint8Array(Buffer.from(data, 'base64')), new Uint8Array(readFileSync(ARCHIVO)))
  assert.match(sheet.css, /font-family: "Archivo"; .*font-weight: 100 900; font-stretch: 62% 125%;/)
})
