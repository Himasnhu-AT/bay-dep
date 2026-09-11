/**
 * Generates bay's app icon.
 *
 * There is no artwork, and shipping Electron's default is worse than shipping a plain mark:
 * the default icon is a specific claim — "this is an unfinished Electron app" — whereas a
 * plain one says only "this is bay". So this draws a mark from the app's own palette rather
 * than pulling in a design dependency or an image library.
 *
 * The mark is the timeline: a dark rounded square with the accent as a playhead over three
 * clip bars. It is legible at 16px because it is three shapes and one vertical line, which is
 * the only thing that survives that size.
 *
 * Written as a standalone script rather than a build step because an icon changes roughly
 * never, the output is committed, and a generator that runs on every build is a generator
 * whose output nobody has looked at.
 *
 *   node build/make-icon.mjs        # writes build/icon.png and build/icon.icns
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// From src/renderer/src/styles.css — the icon and the app must not drift apart.
const SURFACE = [0x12, 0x13, 0x17]
const ACCENT = [0xe9, 0xa2, 0x3b]
const CLIP_VIDEO = [0x3d, 0x51, 0x66]
const CLIP_AUDIO = [0x35, 0x60, 0x47]

const SIZE = 1024

/** Row-major RGBA. */
function canvas(size) {
  return { size, data: new Uint8Array(size * size * 4) }
}

function blend(target, index, [r, g, b], alpha) {
  if (alpha <= 0) return
  const a = Math.min(1, alpha)
  const inv = 1 - a
  target[index] = Math.round(target[index] * inv + r * a)
  target[index + 1] = Math.round(target[index + 1] * inv + g * a)
  target[index + 2] = Math.round(target[index + 2] * inv + b * a)
  target[index + 3] = Math.round(target[index + 3] * inv + 255 * a)
}

/**
 * Coverage of a rounded rectangle at a pixel, sampled 3x3.
 *
 * Supersampled rather than analytic because the edges are what make an icon look drawn rather
 * than computed, and at 1024px a 3x3 sample is visually identical to anything more expensive.
 */
function roundedCoverage(px, py, x, y, w, h, radius) {
  let hits = 0
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const cx = px + (sx + 0.5) / 3
      const cy = py + (sy + 0.5) / 3
      if (cx < x || cx > x + w || cy < y || cy > y + h) continue
      const dx = Math.max(x + radius - cx, cx - (x + w - radius), 0)
      const dy = Math.max(y + radius - cy, cy - (y + h - radius), 0)
      if (dx * dx + dy * dy <= radius * radius) hits += 1
    }
  }
  return hits / 9
}

function fillRounded(image, x, y, w, h, radius, colour) {
  const r = Math.min(radius, w / 2, h / 2)
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(image.size, Math.ceil(x + w))
  const y1 = Math.min(image.size, Math.ceil(y + h))
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const coverage = roundedCoverage(px, py, x, y, w, h, r)
      if (coverage > 0) blend(image.data, (py * image.size + px) * 4, colour, coverage)
    }
  }
}

function draw() {
  const image = canvas(SIZE)
  const u = SIZE / 1024

  // macOS rounds the icon itself on recent systems, but a squircle drawn in still reads
  // correctly inside that mask and correctly on platforms that do not mask at all.
  fillRounded(image, 0, 0, SIZE, SIZE, 224 * u, SURFACE)

  // Three clip bars, staggered the way clips sit on a timeline rather than aligned, because
  // aligned bars read as a list and staggered ones read as an edit.
  const lane = 108 * u
  const gap = 52 * u
  const top = 320 * u
  fillRounded(image, 176 * u, top, 520 * u, lane, 26 * u, CLIP_VIDEO)
  fillRounded(image, 272 * u, top + lane + gap, 576 * u, lane, 26 * u, CLIP_VIDEO)
  fillRounded(image, 176 * u, top + (lane + gap) * 2, 400 * u, lane, 26 * u, CLIP_AUDIO)

  // The playhead: the one saturated thing, and the only element that crosses the others.
  fillRounded(image, 486 * u, 208 * u, 30 * u, 608 * u, 15 * u, ACCENT)
  return image
}

// --- PNG encoding ---------------------------------------------------------
// Hand-rolled because the only alternative was a dependency, and a PNG writer for one known
// case is ~30 lines: filter byte 0 per row, one IDAT, CRC32 per chunk.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

function encodePng(image) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.size, 0)
  header.writeUInt32BE(image.size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc(image.size * (image.size * 4 + 1))
  for (let y = 0; y < image.size; y += 1) {
    const rowStart = y * (image.size * 4 + 1)
    raw[rowStart] = 0 // no filter
    Buffer.from(image.data.buffer, y * image.size * 4, image.size * 4).copy(raw, rowStart + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- Output ---------------------------------------------------------------

const png = encodePng(draw())
const pngPath = join(HERE, 'icon.png')
writeFileSync(pngPath, png)
console.log(`icon.png  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(0)} KB`)

// `iconutil` is the only supported way to produce a .icns, and it wants an .iconset directory
// of exact names. `sips` does the downscaling; both ship with macOS.
if (process.platform === 'darwin') {
  const work = mkdtempSync(join(tmpdir(), 'bay-icon-'))
  const iconset = join(work, 'icon.iconset')
  execFileSync('mkdir', ['-p', iconset])
  const variants = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]
  for (const [size, name] of variants) {
    execFileSync('sips', ['-z', String(size), String(size), pngPath, '--out', join(iconset, name)], {
      stdio: 'ignore'
    })
  }
  const icns = join(HERE, 'icon.icns')
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns])
  rmSync(work, { recursive: true, force: true })
  console.log(`icon.icns written`)
}
