/**
 * Attachments, prepared against bay's real ffmpeg: what lands in the turn's folder, what the model
 * is told, and that a contact sheet's cells are the moments its note names — measured on the
 * pixels, with a video whose colour changes at a known time.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_GRID_EDGE } from '@shared/frame-grid'
import type { AgentAttachmentInput } from '@shared/agent-attachments'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import {
  clockTime,
  contactSheetArgs,
  contactSheetPlan,
  fitWithin,
  MAX_IMAGE_EDGE,
  prepareAttachments,
  sweepAttachments,
  withAttachmentNotes
} from './attachments'

const VENDORED = vendoredTools()
const TOOLS = VENDORED ? { ffmpeg: VENDORED.ffmpeg, ffprobe: VENDORED.ffprobe } : null
const SKIP = TOOLS ? false : NO_VENDORED_FFMPEG

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bay-attach-'))
}

/** A file made by ffmpeg from a lavfi source. */
function make(dir: string, name: string, args: string[]): string {
  const out = join(dir, name)
  execFileSync(TOOLS!.ffmpeg, ['-v', 'error', '-y', ...args, out])
  return out
}

function size(path: string): { width: number; height: number } {
  const text = execFileSync(TOOLS!.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  const [width, height] = text.trim().split(',').map(Number)
  return { width: width ?? 0, height: height ?? 0 }
}

/** The picture as RGB bytes. */
function pixels(path: string): { width: number; height: number; rgb: Buffer } {
  const { width, height } = size(path)
  const rgb = execFileSync(TOOLS!.ffmpeg, ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 })
  return { width, height, rgb }
}

const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(path))
const allowNothing = (): boolean => false

test('a long side past the bound is scaled to it, keeping the shape; anything inside is left alone', () => {
  assert.deepEqual(fitWithin(4000, 3000, 2000), { width: 2000, height: 1500 })
  assert.deepEqual(fitWithin(1000, 3000, 2000), { width: 667, height: 2000 })
  assert.deepEqual(fitWithin(2000, 1000, 2000), { width: 2000, height: 1000 })
  assert.deepEqual(fitWithin(640, 360, 2000), { width: 640, height: 360 })
})

test('times read as minutes, seconds and tenths', () => {
  assert.equal(clockTime(0), '0:00.0')
  assert.equal(clockTime(5.25), '0:05.3')
  assert.equal(clockTime(83.25), '1:23.3')
  assert.equal(clockTime(59.96), '1:00.0')
})

test('a contact sheet samples the middle of equal slices, two a second at most, twelve at most', () => {
  const long = contactSheetPlan(60, 1920, 1080)
  assert.equal(long.times.length, 12)
  assert.equal(long.times[0], 2.5)
  assert.equal(long.times[11], 57.5)
  assert.ok(long.layout.width <= MAX_GRID_EDGE && long.layout.height <= MAX_GRID_EDGE)
  assert.equal(long.layout.columns * long.layout.rows >= 12, true)

  const short = contactSheetPlan(3, 1920, 1080)
  assert.equal(short.times.length, 6)
  assert.deepEqual(short.times, [0.25, 0.75, 1.25, 1.75, 2.25, 2.75])

  // A portrait clip tiles into portrait cells, not a 16:9 guess.
  const portrait = contactSheetPlan(10, 1080, 1920)
  assert.ok(portrait.layout.cellHeight > portrait.layout.cellWidth)
})

test('the sheet seeks each moment on the input side, so a long file is never decoded from the start', () => {
  const plan = contactSheetPlan(3600, 1920, 1080)
  const args = contactSheetArgs('/m/long.mov', plan, '/o/sheet.jpg')
  for (const t of plan.times) {
    const at = args.indexOf(t.toFixed(3))
    assert.ok(at > 0 && args[at - 1] === '-ss' && args[at + 1] === '-i', `no input-side seek to ${t}`)
  }
  assert.equal(args.filter((a) => a === '-i').length, plan.times.length)
  assert.equal(args.at(-1), '/o/sheet.jpg')
})

test('a video becomes one contact sheet whose cells are the moments its note names', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = scratch()
  // Four seconds: red for two, then blue for two. Eight cells at 0.25, 0.75 … 3.75.
  const video = make(dir, 'two-colours.mp4', [
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=25:d=2',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p', '-c:v', 'mjpeg', '-q:v', '3'
  ])
  const root = join(dir, 'agent-attachments')
  const result = await prepareAttachments(
    [{ source: 'bytes', kind: 'video', name: 'two-colours.mp4', mime: 'video/mp4', data: bytesOf(video) }],
    { root, turn: 't1', tools: TOOLS!, isAllowed: allowNothing }
  )
  assert.ok(result.ok, !result.ok ? result.error : '')
  const [sheet] = result.attachments
  assert.ok(sheet)
  assert.equal(sheet.mediaType, 'image/jpeg')
  assert.ok(sheet.path.startsWith(join(root, 't1')))
  assert.match(sheet.note, /8 frames in a \d×\d grid, read left to right then top to bottom, at 0:00\.3, 0:00\.8, 0:01\.3, 0:01\.8, 0:02\.3, 0:02\.8, 0:03\.3, 0:03\.8\./)
  // Nothing but the sheet is left: the staged video is gone.
  assert.deepEqual(readdirSync(join(root, 't1')), [sheet.path.split('/').at(-1)])

  const plan = contactSheetPlan(4, 320, 180)
  const { columns, cellWidth, cellHeight } = plan.layout
  const picture = pixels(sheet.path)
  assert.equal(picture.width, plan.layout.width)
  const colours = plan.times.map((_t, i) => {
    const x = (i % columns) * cellWidth + Math.floor(cellWidth / 2)
    const y = Math.floor(i / columns) * cellHeight + Math.floor(cellHeight / 2)
    const at = (y * picture.width + x) * 3
    const [r, , b] = [picture.rgb[at] ?? 0, picture.rgb[at + 1] ?? 0, picture.rgb[at + 2] ?? 0]
    return r > 150 && b < 100 ? 'red' : b > 150 && r < 100 ? 'blue' : `other(${r},${b})`
  })
  assert.deepEqual(colours, ['red', 'red', 'red', 'red', 'blue', 'blue', 'blue', 'blue'])
})

test('a PNG or JPEG inside the bound is sent byte for byte; a large one is scaled to the bound', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = scratch()
  const small = make(dir, 'small.jpg', ['-f', 'lavfi', '-i', 'color=c=green:s=100x80', '-frames:v', '1'])
  const wide = make(dir, 'wide.png', ['-f', 'lavfi', '-i', 'testsrc2=s=3000x1000', '-frames:v', '1'])
  const root = join(dir, 'agent-attachments')
  const result = await prepareAttachments(
    [
      { source: 'bytes', kind: 'image', name: 'small.jpg', mime: 'image/jpeg', data: bytesOf(small) },
      { source: 'bytes', kind: 'image', name: 'wide.png', mime: 'image/png', data: bytesOf(wide) }
    ],
    { root, turn: 't1', tools: TOOLS!, isAllowed: allowNothing }
  )
  assert.ok(result.ok, !result.ok ? result.error : '')
  const [kept, scaled] = result.attachments
  assert.ok(kept && scaled)
  const hash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
  assert.equal(hash(kept.path), hash(small))
  assert.equal(kept.mediaType, 'image/jpeg')
  assert.equal(kept.note, 'Image 1: “small.jpg” (100×80).')

  assert.deepEqual(size(scaled.path), { width: MAX_IMAGE_EDGE, height: 667 })
  assert.equal(scaled.mediaType, 'image/png')
  assert.equal(scaled.note, 'Image 2: “wide.png” (3000×1000, sent scaled to 2000×667).')
  for (const name of readdirSync(join(root, 't1'))) assert.match(name, /\.(png|jpg)$/, `left behind ${name}`)
})

test('WebP and GIF become PNG, because not every runtime takes them', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = scratch()
  // The build has no WebP encoder, so a real WebP is spelled out: VP8L, 1×1 (ffprobe reads it as such).
  const webp = join(dir, 'a.webp')
  writeFileSync(webp, Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'))
  const gif = make(dir, 'a.gif', ['-f', 'lavfi', '-i', 'color=c=yellow:s=64x64:r=5:d=1'])
  const result = await prepareAttachments(
    [
      { source: 'bytes', kind: 'image', name: 'a.webp', mime: 'image/webp', data: bytesOf(webp) },
      { source: 'bytes', kind: 'image', name: 'a.gif', mime: 'image/gif', data: bytesOf(gif) }
    ],
    { root: join(dir, 'root'), turn: 't', tools: TOOLS!, isAllowed: allowNothing }
  )
  assert.ok(result.ok, !result.ok ? result.error : '')
  for (const a of result.attachments) {
    assert.equal(a.mediaType, 'image/png')
    assert.ok(a.path.endsWith('.png'))
    assert.deepEqual([...readFileSync(a.path).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  }
})

test('an asset is read only when the allowlist holds its path, and the refusal says what to do', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = scratch()
  const photo = make(dir, 'photo.png', ['-f', 'lavfi', '-i', 'color=c=white:s=40x40', '-frames:v', '1'])
  const input: AgentAttachmentInput = { source: 'asset', kind: 'image', name: 'photo', assetId: 'asset-7', path: photo }
  const root = join(dir, 'root')

  const refused = await prepareAttachments([input], { root, turn: 'no', tools: TOOLS!, isAllowed: allowNothing })
  assert.equal(refused.ok, false)
  assert.match(!refused.ok ? refused.error : '', /“photo” is not a file this project holds.*Drag it from the media bin/)
  assert.equal(existsSync(join(root, 'no')), false, 'a refused message leaves no folder behind')

  const allowed = await prepareAttachments([input], { root, turn: 'yes', tools: TOOLS!, isAllowed: (p) => p === photo })
  assert.ok(allowed.ok, !allowed.ok ? allowed.error : '')
  assert.equal(allowed.attachments[0]?.note, 'Image 1: “photo” (40×40), the project asset asset-7.')
  // A copy in bay's folder, never the asset's own path, is what the runtime reads.
  assert.ok(allowed.attachments[0]?.path.startsWith(join(root, 'yes')))
})

test('one attachment that cannot be read refuses the whole message, naming it', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = scratch()
  const good = make(dir, 'ok.png', ['-f', 'lavfi', '-i', 'color=c=white:s=40x40', '-frames:v', '1'])
  const root = join(dir, 'root')
  const result = await prepareAttachments(
    [
      { source: 'bytes', kind: 'image', name: 'ok.png', mime: 'image/png', data: bytesOf(good) },
      { source: 'bytes', kind: 'video', name: 'notes.mov', mime: 'video/quicktime', data: new TextEncoder().encode('not a video at all') }
    ],
    { root, turn: 't', tools: TOOLS!, isAllowed: allowNothing }
  )
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /“notes\.mov” has no video in it that ffmpeg can read/)
  assert.equal(existsSync(join(root, 't')), false)
})

test('the sweep removes every attachment folder, and is harmless when there is none', () => {
  const dir = scratch()
  const root = join(dir, 'agent-attachments')
  mkdirSync(join(root, 'turn-a'), { recursive: true })
  writeFileSync(join(root, 'turn-a', 'x.png'), 'x')
  sweepAttachments(root)
  assert.equal(existsSync(root), false)
  assert.doesNotThrow(() => sweepAttachments(root))
  // Only the root it was given: its parent and siblings stay.
  assert.equal(existsSync(dir), true)
})

test('the model is told what each picture is, in order, after what the user typed', () => {
  assert.equal(withAttachmentNotes('make it pop', []), 'make it pop')
  const text = withAttachmentNotes('match this look', [
    { path: '/r/a.png', mediaType: 'image/png', note: 'Image 1: “ref.png” (800×600).' },
    { path: '/r/b.jpg', mediaType: 'image/jpeg', note: 'Video 1: “take.mov” …' }
  ])
  assert.equal(text, 'match this look\n\nAttached by the user (the attached pictures, in this order):\n- Image 1: “ref.png” (800×600).\n- Video 1: “take.mov” …')
})
