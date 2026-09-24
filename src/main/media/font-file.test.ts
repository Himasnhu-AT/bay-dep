/**
 * Reading real font files: a variable TrueType (Archivo, the Shinobi rebuild's face), a variable
 * WOFF2 (Inter, which bay bundles), and a WOFF built here from the Archivo bytes — plus the
 * refusals a file that is not a font gets.
 *
 * The Archivo case is the one that failed in the Shinobi rebuild: its name ID 1 is "Archivo
 * SemiBold" (the default instance), so a face registered under ID 1 would not answer to
 * "Archivo". The test asserts the specimen really has that property before trusting the answer.
 *
 * Archivo is read from the studio's assets folder (read-only) and the test skips, loudly, when it
 * is not there.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { readFontInfo } from './font-file'

const ARCHIVO = '/Users/himanshu/codes/dodle/studio/video/assets/fonts/Archivo[wdth,wght].ttf'
const require_ = createRequire(import.meta.url)
let INTER = ''
try {
  INTER = join(dirname(require_.resolve('@fontsource-variable/inter/package.json')), 'files', 'inter-latin-standard-normal.woff2')
} catch {
  INTER = ''
}
const skipArchivo = existsSync(ARCHIVO) ? false : `no Archivo at ${ARCHIVO}`
const skipInter = INTER && existsSync(INTER) ? false : 'no bundled Inter woff2 — run pnpm install'

/** The name table's raw ID 1, read independently of the parser under test. */
function rawNameId(bytes: Uint8Array, id: number): string | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = dv.getUint16(4)
  for (let i = 0; i < count; i += 1) {
    const r = 12 + i * 16
    if (String.fromCharCode(...bytes.subarray(r, r + 4)) !== 'name') continue
    const at = dv.getUint32(r + 8)
    const n = dv.getUint16(at + 2)
    const storage = at + dv.getUint16(at + 4)
    for (let j = 0; j < n; j += 1) {
      const rec = at + 6 + j * 12
      if (dv.getUint16(rec) !== 3 || dv.getUint16(rec + 6) !== id) continue
      const len = dv.getUint16(rec + 8)
      const off = storage + dv.getUint16(rec + 10)
      let s = ''
      for (let k = 0; k < len; k += 2) s += String.fromCharCode(dv.getUint16(off + k))
      return s
    }
  }
  return null
}

/** A WOFF 1.0 file from an sfnt — zlib per table, the format's whole trick. */
function toWoff(sfnt: Uint8Array): Uint8Array {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength)
  const count = dv.getUint16(4)
  const tables: { tag: Uint8Array; data: Uint8Array; original: number; checksum: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const r = 12 + i * 16
    const offset = dv.getUint32(r + 8)
    const length = dv.getUint32(r + 12)
    const raw = sfnt.subarray(offset, offset + length)
    const packed = new Uint8Array(deflateSync(raw))
    tables.push({ tag: sfnt.subarray(r, r + 4), data: packed.length < raw.length ? packed : raw, original: length, checksum: dv.getUint32(r + 4) })
  }
  const pad = (n: number): number => (n + 3) & ~3
  let size = 44 + count * 20
  const offsets = tables.map((t) => {
    const at = size
    size += pad(t.data.length)
    return at
  })
  const out = new Uint8Array(size)
  const w = new DataView(out.buffer)
  out.set([0x77, 0x4f, 0x46, 0x46], 0) // wOFF
  w.setUint32(4, dv.getUint32(0))
  w.setUint32(8, size)
  w.setUint16(12, count)
  tables.forEach((t, i) => {
    const r = 44 + i * 20
    out.set(t.tag, r)
    w.setUint32(r + 4, offsets[i]!)
    w.setUint32(r + 8, t.data.length)
    w.setUint32(r + 12, t.original)
    w.setUint32(r + 16, t.checksum)
    out.set(t.data, offsets[i]!)
  })
  return out
}

test('a variable TTF registers under its typographic family, with both axes as ranges', { skip: skipArchivo }, () => {
  const bytes = new Uint8Array(readFileSync(ARCHIVO))
  // Specimen: name ID 1 is the default instance, not the family a designer types.
  assert.equal(rawNameId(bytes, 1), 'Archivo SemiBold', 'specimen: ID 1 is not the family')
  const info = readFontInfo(bytes, ARCHIVO)
  assert.equal(info.family, 'Archivo')
  assert.equal(info.postscriptName, 'Archivo-SemiBold')
  assert.deepEqual(info.axes, [
    { tag: 'wght', min: 100, default: 600, max: 900 },
    { tag: 'wdth', min: 62, default: 100, max: 125 }
  ])
  assert.equal(info.weight, '100 900', 'a range, or every other weight clamps to one')
  assert.equal(info.stretch, '62% 125%')
  assert.equal(info.style, 'normal')
  assert.equal(info.format, 'truetype')
  assert.equal(info.importedFrom, ARCHIVO)
})

test('the same face as WOFF reads identically', { skip: skipArchivo }, () => {
  const sfnt = new Uint8Array(readFileSync(ARCHIVO))
  const woff = toWoff(sfnt)
  assert.ok(woff.length < sfnt.length * 0.8, 'specimen: the tables really are compressed')
  const a = readFontInfo(sfnt, 'x')
  const b = readFontInfo(woff, 'x')
  assert.deepEqual({ ...b, format: 'truetype' }, a)
  assert.equal(b.format, 'woff')
})

test('a variable WOFF2 decompresses and reads, axes included', { skip: skipInter }, () => {
  const info = readFontInfo(new Uint8Array(readFileSync(INTER)), INTER)
  assert.equal(info.family, 'Inter')
  assert.equal(info.format, 'woff2')
  assert.deepEqual(info.axes.map((a) => a.tag).sort(), ['opsz', 'wght'])
  assert.equal(info.weight, '100 900')
  assert.equal(info.stretch, '100%', 'no wdth axis: the width class')
})

test('a file that is not a font is refused with a reason; a cut-short font too', { skip: skipArchivo }, () => {
  assert.throws(() => readFontInfo(new TextEncoder().encode('<html>not a font at all</html>'), 'x'), /does not start like a TrueType, OpenType, WOFF or WOFF2 font/)
  const cut = new Uint8Array(readFileSync(ARCHIVO)).subarray(0, 2000)
  assert.throws(() => readFontInfo(cut, 'x'), /runs past the end of the file|cut short/)
  // The nearest legal call.
  assert.equal(readFontInfo(new Uint8Array(readFileSync(ARCHIVO)), 'x').family, 'Archivo')
})

/** A minimal sfnt holding only a `name` table, from (platform, encoding, language, id, text) records. */
function nameOnlyFont(records: [number, number, number, number, string][]): Uint8Array {
  const encoded = records.map(([platform, , , , text]) => {
    if (platform === 1) return new Uint8Array([...text].map((c) => c.charCodeAt(0)))
    const out = new Uint8Array(text.length * 2)
    for (let i = 0; i < text.length; i += 1) {
      out[i * 2] = text.charCodeAt(i) >> 8
      out[i * 2 + 1] = text.charCodeAt(i) & 0xff
    }
    return out
  })
  const headerSize = 6 + records.length * 12
  const tableLength = headerSize + encoded.reduce((n, e) => n + e.length, 0)
  const out = new Uint8Array(12 + 16 + tableLength)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x00010000)
  dv.setUint16(4, 1)
  out.set([0x6e, 0x61, 0x6d, 0x65], 12) // 'name'
  dv.setUint32(12 + 8, 28)
  dv.setUint32(12 + 12, tableLength)
  const at = 28
  dv.setUint16(at + 2, records.length)
  dv.setUint16(at + 4, headerSize)
  let offset = 0
  records.forEach(([platform, encoding, language, id], i) => {
    const r = at + 6 + i * 12
    dv.setUint16(r, platform)
    dv.setUint16(r + 2, encoding)
    dv.setUint16(r + 4, language)
    dv.setUint16(r + 6, id)
    dv.setUint16(r + 8, encoded[i]!.length)
    dv.setUint16(r + 10, offset)
    out.set(encoded[i]!, at + headerSize + offset)
    offset += encoded[i]!.length
  })
  return out
}

test('names: Windows English wins over a Mac record for the same id, whichever comes first', () => {
  const macFirst = nameOnlyFont([
    [1, 0, 0, 16, 'Legacy Mac Name'],
    [3, 1, 0x409, 16, 'Studio Sans'],
    [3, 1, 0x40c, 1, 'Studio Sans Fr']
  ])
  const info = readFontInfo(macFirst, 'x')
  assert.equal(info.family, 'Studio Sans')
  assert.equal(info.weight, '400', 'no OS/2: the regular weight')
  // The nearest case the other way: only a Mac record, and it is used.
  assert.equal(readFontInfo(nameOnlyFont([[1, 0, 0, 1, 'Only Mac']]), 'x').family, 'Only Mac')
})
