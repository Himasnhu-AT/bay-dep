/**
 * Reading a font file's own tables: its names, its variable axes, its weight, width and style.
 *
 * Pure and Node-only (`node:zlib` for WOFF and WOFF2), so it runs under `pnpm test` against real
 * files. It reads only what registering and describing the face needs — `name`, `fvar`, `OS/2`,
 * `head` — and never the glyphs, which is why WOFF2's glyph transforms do not concern it: the
 * tables it reads are stored untransformed.
 *
 * The family matters most. A variable font's name ID 1 is usually its *default instance*
 * ("Archivo SemiBold" — measured on Archivo[wdth,wght].ttf), which is why naming the installed
 * font "Archivo" failed in the Shinobi rebuild. The typographic family (ID 16) is what a designer
 * types, so it wins when present.
 */

import { brotliDecompressSync, inflateSync } from 'node:zlib'
import type { FontAxis, FontInfo } from '@shared/project'

type Tables = Map<string, Uint8Array>

class FontFileError extends Error {}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function tag(dv: DataView, at: number): string {
  return String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3))
}

function slice(bytes: Uint8Array, offset: number, length: number, what: string): Uint8Array {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new FontFileError(`its ${what} table runs past the end of the file`)
  }
  return bytes.subarray(offset, offset + length)
}

/** The table directory of a plain sfnt (TrueType or CFF-flavoured OpenType) at `start`. */
function sfntTables(bytes: Uint8Array, start: number): Tables {
  const dv = view(bytes)
  const count = dv.getUint16(start + 4)
  const tables: Tables = new Map()
  for (let i = 0; i < count; i += 1) {
    const record = start + 12 + i * 16
    if (record + 16 > bytes.byteLength) throw new FontFileError('its table directory is cut short')
    const name = tag(dv, record)
    tables.set(name, slice(bytes, dv.getUint32(record + 8), dv.getUint32(record + 12), name))
  }
  return tables
}

function woffTables(bytes: Uint8Array): Tables {
  const dv = view(bytes)
  const count = dv.getUint16(12)
  const tables: Tables = new Map()
  for (let i = 0; i < count; i += 1) {
    const record = 44 + i * 20
    const name = tag(dv, record)
    const data = slice(bytes, dv.getUint32(record + 4), dv.getUint32(record + 8), name)
    const original = dv.getUint32(record + 12)
    tables.set(name, data.byteLength < original ? new Uint8Array(inflateSync(data)) : data)
  }
  return tables
}

/** WOFF2's table tags, by the index its directory uses for the common ones. */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt',
  'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'
]

function woff2Tables(bytes: Uint8Array): Tables {
  const dv = view(bytes)
  if (tag(dv, 4) === 'ttcf') throw new FontFileError('it is a font collection; import one font from it')
  const count = dv.getUint16(12)
  const compressedLength = dv.getUint32(20)
  let at = 48
  const base128 = (): number => {
    let value = 0
    for (let i = 0; i < 5; i += 1) {
      const byte = dv.getUint8(at)
      at += 1
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new FontFileError('its table directory has a malformed length')
  }
  const entries: { name: string; length: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const flags = dv.getUint8(at)
    at += 1
    const index = flags & 0x3f
    const version = flags >> 6
    let name: string
    if (index === 63) {
      name = tag(dv, at)
      at += 4
    } else {
      name = WOFF2_TAGS[index] ?? '????'
    }
    const original = base128()
    // `glyf` and `loca` are transformed unless their version is 3; every other table is
    // transformed only when its version is not 0. A transformed table stores its own length.
    const transformed = name === 'glyf' || name === 'loca' ? version !== 3 : version !== 0
    const length = transformed ? base128() : original
    entries.push({ name, length })
  }
  let stream: Uint8Array
  try {
    stream = new Uint8Array(brotliDecompressSync(slice(bytes, at, compressedLength, 'compressed')))
  } catch (error) {
    if (error instanceof FontFileError) throw error
    throw new FontFileError('its compressed tables would not decompress')
  }
  const tables: Tables = new Map()
  let offset = 0
  for (const entry of entries) {
    tables.set(entry.name, slice(stream, offset, entry.length, entry.name))
    offset += entry.length
  }
  return tables
}

function tablesOf(bytes: Uint8Array): { tables: Tables; format: FontInfo['format'] } {
  if (bytes.byteLength < 12) throw new FontFileError('it is too short to be a font')
  const dv = view(bytes)
  const signature = tag(dv, 0)
  if (signature === 'wOF2') return { tables: woff2Tables(bytes), format: 'woff2' }
  if (signature === 'wOFF') return { tables: woffTables(bytes), format: 'woff' }
  if (signature === 'ttcf') {
    return { tables: sfntTables(bytes, dv.getUint32(12)), format: 'truetype' }
  }
  if (signature === 'OTTO') return { tables: sfntTables(bytes, 0), format: 'opentype' }
  if (dv.getUint32(0) === 0x00010000 || signature === 'true') {
    return { tables: sfntTables(bytes, 0), format: 'truetype' }
  }
  throw new FontFileError('it does not start like a TrueType, OpenType, WOFF or WOFF2 font')
}

/** Name ID → string, preferring Windows English, then any Windows, then Unicode, then Mac. */
function names(table: Uint8Array | undefined): Map<number, string> {
  const out = new Map<number, string>()
  if (!table || table.byteLength < 6) return out
  const dv = view(table)
  const count = dv.getUint16(2)
  const storage = dv.getUint16(4)
  const rank = new Map<number, number>()
  for (let i = 0; i < count; i += 1) {
    const r = 6 + i * 12
    if (r + 12 > table.byteLength) break
    const platform = dv.getUint16(r)
    const encoding = dv.getUint16(r + 2)
    const language = dv.getUint16(r + 4)
    const id = dv.getUint16(r + 6)
    const length = dv.getUint16(r + 8)
    const offset = dv.getUint16(r + 10)
    const score =
      platform === 3 && language === 0x409 ? 4 : platform === 3 ? 3 : platform === 0 ? 2 : platform === 1 && encoding === 0 ? 1 : 0
    if (score === 0 || score <= (rank.get(id) ?? 0)) continue
    const start = storage + offset
    if (start + length > table.byteLength) continue
    const raw = table.subarray(start, start + length)
    let text = ''
    if (platform === 1) {
      for (const byte of raw) text += String.fromCharCode(byte)
    } else {
      for (let j = 0; j + 1 < raw.length; j += 2) text += String.fromCharCode((raw[j]! << 8) | raw[j + 1]!)
    }
    text = text.trim()
    if (!text) continue
    rank.set(id, score)
    out.set(id, text)
  }
  return out
}

function axesOf(table: Uint8Array | undefined): FontAxis[] {
  if (!table || table.byteLength < 16) return []
  const dv = view(table)
  const offset = dv.getUint16(4)
  const count = dv.getUint16(8)
  const size = dv.getUint16(10)
  const fixed = (at: number): number => Math.round((dv.getInt32(at) / 65536) * 1000) / 1000
  const out: FontAxis[] = []
  for (let i = 0; i < count; i += 1) {
    const at = offset + i * size
    if (at + 16 > table.byteLength) break
    out.push({ tag: tag(dv, at), min: fixed(at + 4), default: fixed(at + 8), max: fixed(at + 12) })
  }
  return out
}

/** OS/2 usWidthClass → percent, per the OpenType spec. */
const WIDTH_PERCENT = [100, 50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200]

/**
 * What a font file is, from its bytes. Throws with a sentence that completes "The file is not a
 * font bay can read: …" when it is not one.
 */
export function readFontInfo(bytes: Uint8Array, importedFrom: string): FontInfo {
  let parsed: { tables: Tables; format: FontInfo['format'] }
  try {
    parsed = tablesOf(bytes)
  } catch (error) {
    if (error instanceof FontFileError) throw error
    throw new FontFileError('its tables could not be read')
  }
  const { tables, format } = parsed
  const named = names(tables.get('name'))
  const family = named.get(16) ?? named.get(1)
  if (!family) throw new FontFileError('it has no family name, so nothing could ask for it')
  const axes = axesOf(tables.get('fvar'))

  const os2 = tables.get('OS/2')
  const os2View = os2 && os2.byteLength >= 64 ? view(os2) : null
  const weightClass = os2View ? os2View.getUint16(4) : 400
  const widthClass = os2View ? os2View.getUint16(6) : 5
  const selection = os2View ? os2View.getUint16(62) : 0
  const head = tables.get('head')
  const macStyle = head && head.byteLength >= 46 ? view(head).getUint16(44) : 0
  const italic = (selection & 0x1) !== 0 || (selection & 0x200) !== 0 || (macStyle & 0x2) !== 0

  const wght = axes.find((a) => a.tag === 'wght')
  const wdth = axes.find((a) => a.tag === 'wdth')
  return {
    family,
    fullName: named.get(4) ?? null,
    postscriptName: named.get(6) ?? null,
    weight: wght ? `${wght.min} ${wght.max}` : String(weightClass > 0 ? weightClass : 400),
    stretch: wdth ? `${wdth.min}% ${wdth.max}%` : `${WIDTH_PERCENT[widthClass] ?? 100}%`,
    style: italic ? 'italic' : 'normal',
    axes,
    format,
    importedFrom
  }
}
