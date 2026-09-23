/**
 * The colours an export carries, measured through the real ffmpeg. Run with `pnpm test`.
 *
 * The compositor draws sRGB; the file is 4:2:0. Without an explicit matrix swscale converts with
 * BT.601 and writes no tags, and players decode an untagged HD stream as BT.709 — so the picture
 * came back darker and hue-shifted: #30d158 (48, 209, 88) decoded as (33, 183, 83). This encodes
 * solid colours with `videoCodecArgs` exactly as `encode.ts` does (RGBA on stdin), then decodes
 * the file the way a player does — reading the matrix from the stream's tags, defaulting to
 * BT.709 for an untagged one — and asserts the colour survived.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { videoCodecArgs } from './codec-args'

const require_ = createRequire(import.meta.url)
const FFMPEG = (require_('ffmpeg-ffprobe-static') as { ffmpegPath?: string | null }).ffmpegPath ?? ''
const FFPROBE = (require_('ffmpeg-ffprobe-static') as { ffprobePath?: string | null }).ffprobePath ?? ''
const SKIP = existsSync(FFMPEG) && existsSync(FFPROBE) ? false : `no bundled ffmpeg at "${FFMPEG}" — run pnpm install`
const SIZE = 64

function roundTrip(rgb: [number, number, number], format: 'mp4' | 'webm'): [number, number, number] {
  const dir = mkdtempSync(join(tmpdir(), 'bay-colour-'))
  const file = join(dir, `c.${format}`)
  const frame = Buffer.alloc(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) frame.set([...rgb, 255], i * 4)
  execFileSync(FFMPEG, [
    '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${SIZE}x${SIZE}`, '-r', '30', '-i', 'pipe:0',
    ...videoCodecArgs(format, 'best'), '-frames:v', '1', '-y', file
  ], { input: frame })
  // A player's view: the stream's own matrix when tagged, BT.709 when not (as for any HD file).
  const tagged = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space', '-of', 'csv=p=0', file]).toString().trim()
  const matrix = tagged === 'bt709' || tagged === 'bt470bg' || tagged === 'smpte170m' ? tagged.replace('bt470bg', 'bt601').replace('smpte170m', 'bt601') : 'bt709'
  const out = execFileSync(FFMPEG, [
    // zimg, not swscale: this ffmpeg's swscale decodes limited range 2 levels low (Y 126 → 126 for grey 128).
    '-v', 'error', '-i', file, '-vf', `zscale=min=${matrix === 'bt709' ? '709' : '470bg'}:rin=limited:m=709:r=full,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'
  ])
  const at = ((SIZE / 2) * SIZE + SIZE / 2) * 3
  return [out[at]!, out[at + 1]!, out[at + 2]!]
}

const SPECIMENS: [number, number, number][] = [
  [0x30, 0xd1, 0x58], // an accent green
  [0xff, 0x45, 0x3a], // a status red
  [0x1c, 0x1c, 0x1e], // a UI surface near black
  [0xeb, 0xeb, 0xf5] // near white
]

for (const format of ['mp4', 'webm'] as const) {
  test(`a ${format} export carries the colours the canvas drew (±2 per channel)`, { skip: SKIP, timeout: 30_000 }, () => {
    for (const rgb of SPECIMENS) {
      const got = roundTrip(rgb, format)
      const off = Math.max(...got.map((v, i) => Math.abs(v - rgb[i]!)))
      assert.ok(off <= 2, `${format}: drew rgb(${rgb.join(', ')}), the file plays as rgb(${got.join(', ')}) — ${off} off`)
    }
  })
}
