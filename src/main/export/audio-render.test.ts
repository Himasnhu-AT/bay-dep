/**
 * The audio graph, rendered by the real ffmpeg and listened to.
 *
 * `audio-graph.test.ts` evaluates the gain expressions as arithmetic. This renders them: two
 * tones either side of a dissolve, mixed by the ffmpeg bay ships, then each tone's level
 * measured per frame. It exists because the graph once passed every structural test while a
 * dissolve was a hard cut in every exported file — the `transition-audio` probe measures the
 * preview, and the preview was right. Run against that code, this reads 440 Hz at full level
 * through frame 85 and gone at 90.
 *
 * Skips loudly when the bundled ffmpeg is absent, because a check that cannot run must not
 * read as a pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { buildAudioGraph } from './audio-graph'
import { animatedVolumeAt } from '@shared/keyframes'
import { transitionAtFrame } from '@shared/project'
import { transitionAudioGains } from '@shared/audio-gain'


const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const RATE = 48_000
const FPS = 30
const PER_FRAME = RATE / FPS

function clip(id: string, assetId: string, from: number, duration: number, sourceStartUs: number): Item {
  return {
    id,
    assetId,
    trackId: 't',
    from,
    durationInFrames: duration,
    sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

function tone(id: string, path: string): Asset {
  return {
    id,
    kind: 'audio',
    name: id,
    path,
    durationUs: 10_000_000,
    width: 0,
    height: 0,
    fps: null,
    hasAudio: true,
    hasVideo: false,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

/** Amplitude of one frequency across one frame of mono samples (Goertzel). */
function levelAt(samples: Int16Array, frequency: number, frame: number): number {
  const n = PER_FRAME
  const start = frame * n
  const w = (2 * Math.PI * Math.round((n * frequency) / RATE)) / n
  const c = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i += 1) {
    const s0 = (samples[start + i] ?? 0) / 32768 + c * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (n / 2)
}

test(
  'a dissolve cross-fades the sound in the rendered file',
  { skip: FFMPEG ? false : NO_VENDORED_FFMPEG },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'bay-audio-'))
    const make = (frequency: number): string => {
      const path = join(dir, `t${frequency}.wav`)
      execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=10`, '-ac', '2', '-ar', String(RATE), path])
      return path
    }
    const timeline: Timeline = {
      id: 'tl',
      name: 'Timeline 1',
      fps: FPS,
      width: 1920,
      height: 1080,
      background: '#000000',
      tracks: [
        {
          id: 't',
          kind: 'audio',
          name: 'A1',
          locked: false,
          muted: false,
          hidden: false,
          items: [clip('out', 'low', 0, 90, 0), clip('in', 'high', 90, 60, 2_000_000)]
        }
      ],
      transitions: [
        { id: 'x', kind: 'cross-dissolve', fromItemId: 'out', toItemId: 'in', durationInFrames: 20 }
      ]
    }
    const project: Project = {
      id: 'p',
      name: 'p',
      version: 1,
      assets: [tone('low', make(440)), tone('high', make(880))],
      timelines: [timeline],
      activeTimelineId: 'tl',
      createdAt: 0,
      updatedAt: 0
    }

    const graph = buildAudioGraph(project, timeline, 0, 150)
    assert.ok(graph, 'two audible clips must produce a graph')
    const mix = join(dir, 'mix.wav')
    execFileSync(FFMPEG, [
      '-v', 'error', '-y',
      ...graph.inputs.flatMap((path) => ['-i', path]),
      '-filter_complex', graph.filter,
      '-map', '[aout]', '-t', '5', '-ac', '1', '-ar', String(RATE), mix
    ])
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', mix, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'])
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))

    const at = (frame: number): { low: number; high: number } => ({
      low: levelAt(samples, 440, frame),
      high: levelAt(samples, 880, frame)
    })
    const full = at(70).low
    assert.ok(full > 0.02, `the outgoing tone must be audible before the window (${full})`)
    const quiet = full * 0.1

    // Outside the window each side alone; inside, both — a cross-fade, not a cut.
    assert.ok(at(70).high < quiet, 'before the window only the outgoing clip sounds')
    assert.ok(at(110).low < quiet && at(110).high > full * 0.8, 'after it only the incoming clip')
    const middle = at(90)
    assert.ok(
      middle.low > full * 0.25 && middle.high > full * 0.25,
      `mid-dissolve both clips must be heard: ${JSON.stringify(middle)} against ${full}`
    )
    // And the balance moves the right way across it.
    assert.ok(at(85).low > at(95).low && at(95).high > at(85).high, 'out falls while in rises')
  }
)

test(
  'an eased (inOut) dissolve follows its curve in the rendered file, not a straight line',
  { skip: FFMPEG ? false : NO_VENDORED_FFMPEG },
  () => {
    // `Transition.ease` shapes the progress export's gain reads (`transitionOfItemAt`). Measured
    // in the file: a quarter and three quarters of the way through the window, the outgoing
    // tone sits where ease-in-out puts it, which is 0.12 of full scale away from linear.
    const dir = mkdtempSync(join(tmpdir(), 'bay-audio-ease-'))
    const make = (frequency: number): string => {
      const path = join(dir, `t${frequency}.wav`)
      execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=10`, '-ac', '2', '-ar', String(RATE), path])
      return path
    }
    const build = (ease?: 'inOut'): { project: Project; timeline: Timeline } => {
      const timeline: Timeline = {
        id: 'tl', name: 'Timeline 1', fps: FPS, width: 1920, height: 1080, background: '#000000',
        tracks: [{ id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [clip('out', 'low', 0, 90, 0), clip('in', 'high', 90, 60, 2_000_000)] }],
        transitions: [{ id: 'x', kind: 'cross-dissolve', fromItemId: 'out', toItemId: 'in', durationInFrames: 40, ...(ease ? { ease } : {}) }]
      }
      const project: Project = {
        id: 'p', name: 'p', version: 1, assets: [tone('low', make(440)), tone('high', make(880))],
        timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0
      }
      return { project, timeline }
    }
    const { project, timeline } = build('inOut')
    const graph = buildAudioGraph(project, timeline, 0, 150)
    assert.ok(graph)
    const mix = join(dir, 'mix.wav')
    execFileSync(FFMPEG, ['-v', 'error', '-y', ...graph.inputs.flatMap((path) => ['-i', path]), '-filter_complex', graph.filter, '-map', '[aout]', '-t', '5', '-ac', '1', '-ar', String(RATE), mix])
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', mix, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'])
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
    const full = levelAt(samples, 440, 40)
    assert.ok(full > 0.02, `the outgoing tone must be audible before the window (${full})`)

    const linear = build()
    const window = transitionAtFrame(project, timeline, 90)!.resolved
    const span = window.lastFrame - window.firstFrame
    for (const fraction of [0.25, 0.75]) {
      const frame = window.firstFrame + Math.round(span * fraction)
      const eased = transitionAudioGains('cross-dissolve', transitionAtFrame(project, timeline, frame)!.progress).from
      const straight = transitionAudioGains('cross-dissolve', transitionAtFrame(linear.project, linear.timeline, frame)!.progress).from
      assert.ok(Math.abs(eased - straight) > 0.08, `the specimen must tell the curves apart at ${fraction}: ${eased} vs ${straight}`)
      const measured = levelAt(samples, 440, frame) / full
      assert.ok(
        Math.abs(measured - eased) < Math.abs(measured - straight) && Math.abs(measured - eased) < 0.05,
        `at ${fraction} of the window the outgoing tone is ${measured.toFixed(3)}; eased ${eased.toFixed(3)}, linear ${straight.toFixed(3)}`
      )
    }
  }
)

// ---------------------------------------------------------------------------
// J/L cuts and ducking, rendered and measured. The preview's routing of the same cases is
// checked in `engine/audio-finish.test.ts` and metered in `test/app/audio-finish.mjs`; these
// are about the exported file only.
// ---------------------------------------------------------------------------

const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG

function lavfi(dir: string, name: string, graph: string): string {
  const path = join(dir, name)
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', graph, '-ac', '2', '-ar', String(RATE), path])
  return path
}

function timelineOf(tracks: Timeline['tracks']): Timeline {
  return { id: 'tl', name: 'Timeline 1', fps: FPS, width: 1920, height: 1080, background: '#000000', tracks, transitions: [] }
}

function projectOf(timeline: Timeline, assets: Asset[]): Project {
  return { id: 'p', name: 'p', version: 1, assets, timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }
}

/** Mixes `timeline` through the real ffmpeg and returns mono samples. */
function render(dir: string, project: Project, timeline: Timeline, frames: number): Int16Array {
  const graph = buildAudioGraph(project, timeline, 0, frames)
  assert.ok(graph, 'an audible timeline must produce a graph')
  const mix = join(dir, `mix-${Math.random().toString(36).slice(2)}.wav`)
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    ...graph.inputs.flatMap((path) => ['-i', path]),
    '-filter_complex', graph.filter,
    '-map', '[aout]', '-t', String(frames / FPS), '-ac', '1', '-ar', String(RATE), mix
  ])
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', mix, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'])
  return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
}

test('a J-cut is heard exactly lead frames before its picture, playing the footage before its in-point', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-jcut-'))
  // The incoming source is 660 Hz for its first 1.75 s and 880 Hz after. The clip's in-point is
  // 2.0 s, so a 15-frame (0.5 s) lead must play 1.5–2.0 s of source: 660 Hz for its first
  // quarter-second, then 880. A lead that merely shifted the clip earlier would play 880 at once.
  const handle = join(dir, 'handle.wav')
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=1.75',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=8.25',
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-ac', '2', '-ar', String(RATE), handle
  ])
  const lead = 15
  const incoming = { ...clip('in', 'high', 90, 60, 2_000_000), audioLeadFrames: lead }
  const timeline = timelineOf([
    { id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [incoming] }
  ])
  const project = projectOf(timeline, [tone('high', handle)])
  const samples = render(dir, project, timeline, 150)

  // Onset to the sample: the first non-silent sample is the lead's first frame, 2.5 s.
  const onset = samples.findIndex((s) => Math.abs(s) > 64)
  const expected = ((90 - lead) / FPS) * RATE
  assert.ok(
    Math.abs(onset - expected) <= RATE / 1000,
    `the sound must start ${lead} frames (${expected} samples) early; it starts at sample ${onset}`
  )
  // And it is the handle footage: 660 in the first quarter-second of the lead, 880 after.
  const full = levelAt(samples, 880, 120)
  assert.ok(full > 0.02, `the clip must be audible in its own span (${full})`)
  assert.ok(levelAt(samples, 660, 78) > full * 0.8, 'the lead opens on the footage before the in-point')
  assert.ok(levelAt(samples, 880, 78) < full * 0.1, 'and not on the footage at the in-point')
  assert.ok(levelAt(samples, 880, 86) > full * 0.8, 'reaching the in-point footage by source time 1.75 s')
})

test('an L-cut runs trail frames past the picture and stops there', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-lcut-'))
  const trail = 12
  const outgoing = { ...clip('out', 'low', 0, 60, 0), audioTrailFrames: trail }
  const timeline = timelineOf([
    { id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [outgoing] }
  ])
  const project = projectOf(timeline, [tone('low', lavfi(dir, 'low.wav', 'sine=frequency=440:duration=10'))])
  const samples = render(dir, project, timeline, 120)
  const full = levelAt(samples, 440, 30)
  assert.ok(full > 0.02)
  assert.ok(levelAt(samples, 440, 60 + trail - 1) > full * 0.8, 'still sounding on the last trail frame')
  assert.ok(levelAt(samples, 440, 60 + trail + 1) < full * 0.05, 'silent after it')
  let last = samples.length - 1
  while (last > 0 && Math.abs(samples[last] ?? 0) <= 64) last -= 1
  const end = ((60 + trail) / FPS) * RATE
  assert.ok(Math.abs(last - end) <= RATE / 1000, `the sound must end at sample ${end}; it ends at ${last}`)
})

test('ducked music is amountDb down under the key, and back up after the release', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-duck-'))
  const amountDb = 12
  const music = {
    ...clip('bed', 'music', 0, 180, 0),
    trackId: 'mus',
    duck: { keyTrackId: 'dia', amountDb, attackFrames: 6, releaseFrames: 6 }
  }
  const line = { ...clip('line', 'voice', 60, 60, 0), trackId: 'dia' }
  const timeline = timelineOf([
    { id: 'mus', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [music] },
    { id: 'dia', kind: 'audio', name: 'A2', locked: false, muted: false, hidden: false, items: [line] }
  ])
  const project = projectOf(timeline, [
    tone('music', lavfi(dir, 'music.wav', 'sine=frequency=450:duration=10')),
    tone('voice', lavfi(dir, 'voice.wav', 'sine=frequency=900:duration=10'))
  ])
  const samples = render(dir, project, timeline, 180)
  const open = levelAt(samples, 450, 30)
  const under = levelAt(samples, 450, 90)
  const measuredDb = 20 * Math.log10(under / open)
  assert.ok(open > 0.02, `the bed must be audible before the line (${open})`)
  assert.ok(
    Math.abs(measuredDb + amountDb) <= 0.5,
    `the bed must sit ${amountDb} dB down under the line; measured ${measuredDb.toFixed(2)} dB`
  )
  // The attack ends as the line starts: already part way down three frames before it.
  const midAttack = 20 * Math.log10(levelAt(samples, 450, 57) / open)
  assert.ok(midAttack < -2 && midAttack > -amountDb + 2, `mid-attack must be between (${midAttack.toFixed(2)} dB)`)
  assert.ok(Math.abs(20 * Math.log10(levelAt(samples, 450, 150) / open)) <= 0.5, 'back to unity after the release')
  // The key itself is untouched.
  assert.ok(levelAt(samples, 900, 90) > open * 0.8, 'the line plays at its own level')
})

test('a volume ride keyed from 0 to −12 dB is in the file, within 0.5 dB, at every point measured', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-ride-'))
  // Static volume 0 on purpose: with keys the keys are what plays, and a walker that still read
  // `item.volume` would drop the clip from the file entirely.
  const ride: Item = {
    ...clip('ride', 'bed', 0, 150, 0),
    volume: 0,
    keyframes: { volume: [{ frame: 30, value: 1 }, { frame: 90, value: 10 ** (-12 / 20) }] }
  }
  const reference: Item = clip('flat', 'bed', 0, 150, 0)
  const bed = tone('bed', lavfi(dir, 'bed.wav', 'sine=frequency=600:duration=10'))
  const measure = (item: Item): Int16Array => {
    const timeline = timelineOf([{ id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [item] }])
    return render(dir, projectOf(timeline, [bed]), timeline, 150)
  }
  const flat = measure(reference)
  const rode = measure(ride)
  // A frame's level is the mean of the gain across it, and the envelope is linear between frame
  // starts — so the expected value at frame n is the curve at n + 0.5, from the shared sampler.
  const expectedDb = (frame: number): number => 20 * Math.log10(animatedVolumeAt(ride, frame + 0.5))
  const measuredDb = (frame: number): number => 20 * Math.log10(levelAt(rode, 600, frame) / levelAt(flat, 600, frame))
  for (const frame of [15, 45, 60, 75, 120]) {
    assert.ok(
      Math.abs(measuredDb(frame) - expectedDb(frame)) <= 0.5,
      `frame ${frame}: expected ${expectedDb(frame).toFixed(2)} dB, measured ${measuredDb(frame).toFixed(2)} dB`
    )
  }
  // The three points on the ramp are really on a ramp: strictly falling, between the ends.
  const on = [45, 60, 75].map(measuredDb)
  assert.ok(on[0]! > on[1]! && on[1]! > on[2]! && on[0]! < -0.5 && on[2]! > -11.5, `a ramp: ${on.map((d) => d.toFixed(2))}`)
})
