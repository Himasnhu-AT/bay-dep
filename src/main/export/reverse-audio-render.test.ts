/**
 * A reversed clip's sound in the exported file: rendered through the ffmpeg bay ships and compared,
 * sample for sample, with the forward render of the same footage read backwards.
 *
 * This is the export path only. The preview is silent for a reversed clip (`retimeSound` in
 * `@shared/retime-sound`) — a media element cannot play backwards — so there is no preview
 * render to compare with, and nothing here says anything about it.
 *
 * The specimen is a rising sweep, because a tone reversed is the same tone: a test on a sine would
 * pass with `areverse` deleted. The first assertion is that the specimen is not its own reverse.
 *
 * Skips loudly when the bundled ffmpeg is absent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { buildAudioGraph } from './audio-graph'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG
const RATE = 48_000
const FPS = 30
const PER_FRAME = RATE / FPS

function clip(extra: Partial<Item> = {}): Item {
  return {
    id: 'c', assetId: 'src', trackId: 't', from: 0, durationInFrames: 60, sourceStartUs: 1_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}

function setup(path: string, item: Item): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: FPS, width: 1920, height: 1080, background: '#000', transitions: [],
    tracks: [{ id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [item] }]
  }
  const asset: Asset = {
    id: 'src', kind: 'audio', name: 'src', path, durationUs: 6_000_000, width: 0, height: 0, fps: null,
    hasAudio: true, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0
  }
  return {
    timeline,
    project: { id: 'p', name: 'p', version: 1, assets: [asset], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }
  }
}

/** A 6 s sweep from 200 Hz upward: every moment has its own pitch, so its reverse is not itself. */
function sweep(dir: string): string {
  const path = join(dir, 'sweep.wav')
  execFileSync(FFMPEG, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='0.4*sin(2*PI*(200*t+150*t*t))':s=${RATE}:d=6`,
    '-ac', '2', '-c:a', 'pcm_f32le', path
  ])
  return path
}

/** Exports timeline frames `[fromFrame, toFrame)` of `item` through the real ffmpeg: the left channel. */
function render(path: string, item: Item, fromFrame: number, toFrame: number): Float32Array {
  const { project, timeline } = setup(path, item)
  const graph = buildAudioGraph(project, timeline, fromFrame, toFrame)
  assert.ok(graph, 'the clip has sound in the range')
  const raw = execFileSync(
    FFMPEG,
    [
      '-v', 'error', ...graph.inputs.flatMap((p) => ['-i', p]), '-filter_complex', graph.filter, '-map', '[aout]',
      '-t', String((toFrame - fromFrame) / FPS), '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  )
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + Math.floor(raw.length / 4) * 4))
}

/** Normalised correlation of `a` with `b` read backwards (1 is identical, 0 unrelated). */
function correlation(a: Float32Array, b: Float32Array, reversed: boolean): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < n; i += 1) {
    const x = a[i]!
    const y = b[reversed ? n - 1 - i : i]!
    dot += x * y
    aa += x * x
    bb += y * y
  }
  return dot / Math.sqrt(aa * bb || 1)
}

test('a reversed clip’s exported sound is the forward render read backwards', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-reverse-audio-'))
  const path = sweep(dir)
  // Forwards: 2 s of the file from 1 s. Reversed: the same footage, read down from 3 s.
  const forward = render(path, clip(), 0, 60)
  const reversed = render(path, clip({ reverse: true, sourceStartUs: 3_000_000 }), 0, 60)
  assert.equal(forward.length, 60 * PER_FRAME)
  assert.equal(reversed.length, 60 * PER_FRAME)

  // The specimen can tell: the sweep is not its own reverse, and the two renders are not alike.
  assert.ok(Math.abs(correlation(forward, forward, true)) < 0.1, `the forward render must differ from its reverse (${correlation(forward, forward, true)})`)
  assert.ok(Math.abs(correlation(reversed, forward, false)) < 0.1, 'a reversed clip must not sound like the forward one')

  // The requirement.
  const match = correlation(reversed, forward, true)
  assert.ok(match > 0.9999, `reversed is the reverse of forward (correlation ${match})`)
  let worst = 0
  for (let i = 0; i < reversed.length; i += 1) worst = Math.max(worst, Math.abs(reversed[i]! - forward[forward.length - 1 - i]!))
  assert.ok(worst < 1e-3, `sample for sample, within ${worst}`)
})

test('exporting part of a reversed clip reads the part it plays there', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-reverse-part-'))
  const path = sweep(dir)
  const reversedClip = clip({ reverse: true, sourceStartUs: 3_000_000 })
  // Timeline frames 20…60 of the reversed clip are the forward clip's frames 0…40, backwards.
  const part = render(path, reversedClip, 20, 60)
  const forward = render(path, clip(), 0, 40)
  assert.equal(part.length, 40 * PER_FRAME)
  const match = correlation(part, forward, true)
  assert.ok(match > 0.9999, `the tail of a reversed clip is the head of its footage (correlation ${match})`)
  // And not the whole clip's first 40 frames reversed, which is what reading from the wrong edge gives.
  const wrong = render(path, clip(), 20, 60)
  assert.ok(Math.abs(correlation(part, wrong, true)) < 0.1, 'the specimen tells the two ranges apart')
})

test('a reversed clip moved along the timeline starts where it sits, and at 2× it is half as long', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-reverse-placed-'))
  const path = sweep(dir)
  // Placed at frame 30: half a second of silence, then the reversed footage.
  const placed = render(path, clip({ reverse: true, sourceStartUs: 3_000_000, from: 30 }), 0, 90)
  const lead = placed.subarray(0, 30 * PER_FRAME - 480)
  assert.ok(lead.every((sample) => Math.abs(sample) < 1e-4), 'silent until the clip starts')
  const body = placed.subarray(30 * PER_FRAME)
  const forward = render(path, clip(), 0, 60)
  assert.ok(correlation(body, forward, true) > 0.999, `then the reversed footage (correlation ${correlation(body, forward, true)})`)

  // At 2× the clip reads 2 s of file in 30 frames. Pitch is kept (`atempo`), so the sweep falls
  // twice as fast: it starts near the late edge's pitch and ends near the early edge's.
  const fast = render(path, clip({ reverse: true, sourceStartUs: 3_000_000, speed: 2, durationInFrames: 30 }), 0, 30)
  assert.equal(fast.length, 30 * PER_FRAME)
  const crossings = (samples: Float32Array): number => {
    let count = 0
    for (let i = 1; i < samples.length; i += 1) if (samples[i - 1]! < 0 !== samples[i]! < 0) count += 1
    return count
  }
  const quarter = Math.floor(fast.length / 4)
  const early = crossings(fast.subarray(0, quarter))
  const late = crossings(fast.subarray(fast.length - quarter))
  // The file's pitch at 3 s is 1100 Hz and at 1 s is 500 Hz: the first quarter must be well above the last.
  assert.ok(early > late * 1.4, `a reversed sweep falls (${early} crossings, then ${late})`)
})

test('the graph reverses only a reversed clip, and a ramped clip is not in it at all', () => {
  const plain = setup('/tmp/x.wav', clip())
  assert.ok(!buildAudioGraph(plain.project, plain.timeline, 0, 60)!.filter.includes('areverse'))
  const reversed = setup('/tmp/x.wav', clip({ reverse: true, sourceStartUs: 3_000_000 }))
  const filter = buildAudioGraph(reversed.project, reversed.timeline, 0, 60)!.filter
  assert.match(filter, /atrim=start=1(\.0+)?:duration=2(\.0+)?,asetpts=N\/SR\/TB,areverse,asetpts=N\/SR\/TB/)
  // Reversed and fast: trimmed to the footage, turned round, then brought to speed.
  const fast = setup('/tmp/x.wav', clip({ reverse: true, sourceStartUs: 3_000_000, speed: 2, durationInFrames: 30 }))
  const fastFilter = buildAudioGraph(fast.project, fast.timeline, 0, 30)!.filter
  assert.ok(fastFilter.indexOf('areverse') < fastFilter.indexOf('atempo=2.0'), fastFilter)
  assert.match(fastFilter, /atrim=start=1(\.0+)?:duration=2(\.0+)?/)
  // A ramp is silent in the export as in the preview: no input is opened for it.
  const ramped = setup('/tmp/x.wav', clip({ keyframes: { speed: [{ frame: 0, value: 1 }, { frame: 30, value: 0.25 }] } }))
  assert.equal(buildAudioGraph(ramped.project, ramped.timeline, 0, 60), null)
})
