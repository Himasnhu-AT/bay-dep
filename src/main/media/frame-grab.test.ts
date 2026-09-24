/**
 * The freeze-frame grab: that the frame written is the one a `<video>` seeked to the same time
 * shows — the last frame at or before it — and not ffmpeg's first frame at or after it.
 *
 * The real-binary cases render a clip whose every frame is a different grey, grab at times on,
 * just past and just before frame boundaries, and identify the grabbed frame by its grey against
 * each source frame put through the same colour step. Skips loudly without the vendored ffmpeg.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { chooseFrame, colourFilter, grabFrame } from './frame-grab'

const tools = vendoredTools()
const SKIP = tools ? false : NO_VENDORED_FFMPEG

test('the chosen frame is the last at or before the time, and the seek lands between it and the one before', () => {
  const frames = [0, 0.042, 0.083, 0.125, 0.167]
  // On a frame, just past it, and just before the next.
  assert.deepEqual(chooseFrame(frames, 0.083), { frameSeconds: 0.083, seekSeconds: (0.042 + 0.083) / 2 })
  assert.equal(chooseFrame(frames, 0.0835)?.frameSeconds, 0.083)
  assert.equal(chooseFrame(frames, 0.1249)?.frameSeconds, 0.083)
  // The naive grab — first frame at or after — would have said 0.125 for 0.0835. The specimen must
  // be one where the two rules differ, or this test would pass against the naive rule.
  assert.equal(frames.find((t) => t >= 0.0835), 0.125)
  // Before the first frame, and past the last.
  assert.equal(chooseFrame([0.5, 0.6], 0.1)?.frameSeconds, 0.5)
  assert.equal(chooseFrame(frames, 99)?.frameSeconds, 0.167)
  // Order and duplicates in the probe do not matter (packets come in decode order).
  assert.equal(chooseFrame([0.125, 0, 0.083, 0.042, 0.083], 0.1)?.frameSeconds, 0.083)
  assert.equal(chooseFrame([], 1), null)
})

test('an untagged stream is read as BT.709, a tagged one by its own matrix', () => {
  assert.match(colourFilter(null), /in_color_matrix=bt709/)
  assert.match(colourFilter('bt470bg'), /in_color_matrix=auto/)
})

const FPS = 24
const FRAMES = 48

/** A clip whose frame n is a flat grey of 5n, in `codec`. */
function source(dir: string, name: string, codecArgs: string[]): string {
  const path = join(dir, name)
  execFileSync(tools!.ffmpeg, [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', `color=c=black:s=64x64:r=${FPS}:d=${FRAMES / FPS},format=yuv420p,geq=lum='16+4*N':cb=128:cr=128`,
    ...codecArgs, path
  ])
  return path
}

/** Each source frame's grey after the grab's own colour step, indexed by frame. */
function references(path: string): number[] {
  const raw = execFileSync(tools!.ffmpeg, [
    '-v', 'error', '-i', path, '-vf', `${colourFilter(null)},format=gray,scale=1:1`, '-f', 'rawvideo', '-'
  ])
  return [...raw]
}

function greyOf(png: string): number {
  const raw = execFileSync(tools!.ffmpeg, ['-v', 'error', '-i', png, '-vf', 'format=gray,scale=1:1', '-f', 'rawvideo', '-'])
  return raw[0]!
}

function frameIndex(levels: readonly number[], grey: number): number {
  let best = 0
  for (let i = 1; i < levels.length; i += 1) {
    if (Math.abs(levels[i]! - grey) < Math.abs(levels[best]! - grey)) best = i
  }
  return best
}

for (const [label, file, codecArgs] of [
  ['VP9 with one keyframe every two seconds', 'grey.webm', ['-c:v', 'libvpx-vp9', '-lossless', '1', '-g', '48']],
  ['PNG in a QuickTime file', 'grey.mov', ['-c:v', 'png']]
] as const) {
  test(`${label}: the grab is the frame an element shows at that time`, { skip: SKIP }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bay-freeze-'))
    const path = source(dir, file, [...codecArgs])
    const levels = references(path)
    assert.equal(levels.length, FRAMES, 'one reference per source frame')
    assert.equal(new Set(levels).size, FRAMES, 'every frame a different grey, so a grab can be identified')

    const out = mkdtempSync(join(tmpdir(), 'bay-freeze-out-'))
    // [seconds asked, frame an element shows there]
    const cases: [number, number][] = [
      [0.0005, 0],
      [10 / FPS + 0.0005, 10], // FRAME_EDGE_SECONDS past frame 10: the compositor's usual ask
      [10 / FPS - 0.001, 9], // a millisecond short of frame 10 — still showing 9
      [1.2, 28], // between frames 28 (1.1667 s) and 29 (1.2083 s)
      [47 / FPS + 0.01, 47]
    ]
    for (const [seconds, expected] of cases) {
      const result = await grabFrame(tools!, path, seconds, out, 'grey clip')
      assert.ok(result.ok, `grab at ${seconds}: ${result.ok ? '' : result.error}`)
      assert.equal(frameIndex(levels, greyOf(result.path)), expected, `at ${seconds.toFixed(4)}s the frame shown is ${expected}`)
    }
    // Content-addressed: grabbing the same frame again names the same file, and leaves no scratch.
    const again = await grabFrame(tools!, path, 1.2, out, 'grey clip')
    const once = await grabFrame(tools!, path, 1.19, out, 'grey clip')
    assert.ok(again.ok && once.ok)
    assert.equal(again.path, once.path)
    assert.match(again.path, /freeze-grey-clip-[0-9a-f]{12}\.png$/)
    assert.equal(readdirSync(out).filter((f) => f.startsWith('.')).length, 0, 'no scratch file left behind')
  })
}

test('a time that is not a time, and a file with no picture, are refused in words', { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-freeze-bad-'))
  const bad = await grabFrame(tools!, join(dir, 'x.webm'), Number.NaN, dir, 'x')
  assert.ok(!bad.ok && /not a time/.test(bad.error))
  const wav = join(dir, 'tone.wav')
  execFileSync(tools!.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=d=1', wav])
  const silent = await grabFrame(tools!, wav, 0.5, dir, 'tone')
  assert.ok(!silent.ok && /tone has no picture/.test(silent.error), silent.ok ? '' : silent.error)
})
