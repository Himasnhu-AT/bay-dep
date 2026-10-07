/**
 * The equaliser, rendered by the real ffmpeg and compared with what the preview computes.
 *
 * **Which path each side measures.** The *export* side is real: `buildAudioGraph` writes the
 * filters, bay's ffmpeg renders them, and the levels and samples are read from the file. The
 * *preview* side is the Web Audio specification's `BiquadFilterNode` arithmetic run here in
 * TypeScript on the values `webAudioBiquad` would set on a node (`nodeFilter` in `specimen.ts` is written
 * from the spec, with its Q-in-decibels, not from `biquadCoefficients`). It is not Chromium: that
 * a real node follows its specification is what `test/app/audio-effects.mjs` meters in the app.
 *
 * Skips loudly without the vendored ffmpeg.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Asset, Item, Project, Timeline, Track } from '@shared/project'
import {
  BUTTERWORTH_Q,
  biquadOf,
  biquadResponseDb,
  chainResponseDb,
  defaultEffect,
  ffmpegBiquad,
  itemEffectPlan,
  trackBusBands,
  webAudioBiquad,
  type AudioEffect,
  type AudioEffectKind,
  type BiquadSpec
} from '@shared/audio-effects'
import { buildAudioGraph } from '../export/audio-graph'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { RATE, decode, nodeFilter, render, sineTerm, synth, toneDb } from './specimen'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG
const FPS = 30

/** Measured level against analytic response, per tone, for every band type. Stated tolerance. */
const LEVEL_TOLERANCE_DB = 0.05
/** Preview arithmetic against the rendered file, sample by sample (−80 dBFS). */
const SAMPLE_TOLERANCE = 1e-4

const TONES = [50, 100, 200, 400, 1000, 2000, 4000, 8000, 12000, 16000]
const TONE_DB = -26

const fx = (kind: AudioEffectKind, params: Record<string, number> = {}, id = kind as string): AudioEffect => {
  const base = defaultEffect(kind, id)
  return { ...base, params: { ...base.params, ...params } }
}

function asset(id: string, path: string): Asset {
  return { id, kind: 'audio', name: id, path, durationUs: 10_000_000, width: 0, height: 0, fps: null, hasAudio: true, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0 }
}
function clip(id: string, assetId: string, from: number, duration: number, extra: Partial<Item> = {}): Item {
  return { id, assetId, trackId: 't', from, durationInFrames: duration, sourceStartUs: 0, layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 }, volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra }
}
function scene(assets: Asset[], items: Item[], track: Partial<Track> = {}): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: FPS, width: 1920, height: 1080, background: '#000000', transitions: [],
    tracks: [{ id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items, ...track }]
  }
  return { timeline, project: { id: 'p', name: 'p', version: 1, assets, timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 } }
}

const BANDS: AudioEffect[] = [
  fx('highpass', { frequency: 200 }),
  fx('highpass', { frequency: 1000, q: 3 }),
  fx('lowpass', { frequency: 4000 }),
  fx('lowpass', { frequency: 9000, q: 2 }),
  fx('lowshelf', { frequency: 300, gain: 9 }),
  fx('lowshelf', { frequency: 150, gain: -6 }),
  fx('highshelf', { frequency: 5000, gain: -12 }),
  fx('highshelf', { frequency: 8000, gain: 6 }),
  fx('bell', { frequency: 1000, gain: 12, q: 2 }),
  fx('bell', { frequency: 8000, gain: -18, q: 6 }),
  fx('bell', { frequency: 250, gain: -4, q: 0.7 })
]

test('each band type, rendered by ffmpeg, has the level the preview’s biquad has at every tone', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-afx-eq-'))
  const multi = synth(FFMPEG, dir, 'multi', TONES.map((f) => sineTerm(f, TONE_DB)).join('+'), 3)
  const dry = decode(FFMPEG, multi)
  for (const f of TONES) {
    // The instrument first: on the unfiltered specimen it must read what was synthesised.
    assert.ok(Math.abs(toneDb(dry, f, RATE, RATE) - TONE_DB) < 0.01, `the meter reads ${f} Hz at ${toneDb(dry, f, RATE, RATE)}`)
  }
  for (const effect of BANDS) {
    const spec = biquadOf(effect)!
    const out = decode(FFMPEG, render(FFMPEG, [multi], `[0:a]${ffmpegBiquad(spec)}[o]`, 'o', join(dir, 'eq.wav')))
    let moved = 0
    for (const f of TONES) {
      const measured = toneDb(out, f, RATE, RATE) - TONE_DB
      const analytic = biquadResponseDb(spec, f, RATE)
      moved = Math.max(moved, Math.abs(measured))
      assert.ok(
        Math.abs(measured - analytic) <= LEVEL_TOLERANCE_DB,
        `${effect.kind} ${JSON.stringify(effect.params)} at ${f} Hz: ffmpeg ${measured.toFixed(3)} dB, the biquad ${analytic.toFixed(3)} dB`
      )
    }
    assert.ok(moved > 3, `${effect.kind}: the specimen must be one this band changes (${moved.toFixed(2)} dB)`)
  }
})

test('preview arithmetic and the exported file are the same samples for a clip’s equaliser chain', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-afx-eqsamples-'))
  const multi = synth(FFMPEG, dir, 'multi', TONES.map((f) => sineTerm(f, TONE_DB)).join('+'), 3)
  const chain = [fx('highpass', { frequency: 120 }, 'a'), fx('bell', { frequency: 2000, gain: 6, q: 1.5 }, 'b'), fx('lowshelf', { frequency: 200, gain: -4 }, 'c'), fx('highshelf', { frequency: 6000, gain: 5 }, 'd'), fx('lowpass', { frequency: 11000 }, 'e')]
  const { project, timeline } = scene([asset('multi', multi)], [clip('c', 'multi', 0, 60, { audioEffects: chain })])

  // Export: the real graph, the real ffmpeg.
  // The specimens are mono; `channels` is what export probes so they are up-mixed at unity.
  const graph = buildAudioGraph(project, timeline, 0, 60, undefined, new Map([[multi, 1]]))
  assert.ok(graph)
  const exported = decode(FFMPEG, render(FFMPEG, graph.inputs, graph.filter, graph.outputLabel, join(dir, 'export.wav'), 2))

  // Preview: the node arithmetic on the same source samples, set from the same plan.
  const plan = itemEffectPlan(timeline.tracks[0], timeline.tracks[0]!.items[0]!)
  assert.equal(plan.clip.length, chain.length)
  let previewed = decode(FFMPEG, multi)
  for (const band of plan.clip) previewed = nodeFilter(webAudioBiquad(band), previewed)

  let worst = 0
  for (let i = 0; i < 2 * RATE; i += 1) worst = Math.max(worst, Math.abs(previewed[i]! - exported[i]!))
  assert.ok(worst <= SAMPLE_TOLERANCE, `the two differ by ${worst} at most (stated tolerance ${SAMPLE_TOLERANCE})`)

  // And the comparison can fail: the same check against the unfiltered source is far outside it.
  const dry = decode(FFMPEG, multi)
  let dryDiff = 0
  for (let i = 0; i < 2 * RATE; i += 1) dryDiff = Math.max(dryDiff, Math.abs(dry[i]! - exported[i]!))
  assert.ok(dryDiff > 100 * SAMPLE_TOLERANCE, `the chain must change the samples (${dryDiff})`)
})

test('a track’s equaliser is on the track’s sum in the export: both clips take it, and a clip on another track does not', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-afx-bus-'))
  const low = synth(FFMPEG, dir, 'low', sineTerm(200, -20), 3)
  const high = synth(FFMPEG, dir, 'high', sineTerm(3000, -20), 3)
  const other = synth(FFMPEG, dir, 'other', sineTerm(6000, -20), 3)
  const busChain = [fx('highpass', { frequency: 800 }, 'hp'), fx('bell', { frequency: 3000, gain: 6, q: 1 }, 'bell')]
  const { project, timeline } = scene(
    [asset('low', low), asset('high', high), asset('other', other)],
    [clip('a', 'low', 0, 60), clip('b', 'high', 0, 60)],
    { audioEffects: busChain }
  )
  timeline.tracks.push({ id: 't2', kind: 'audio', name: 'A2', locked: false, muted: false, hidden: false, items: [{ ...clip('c', 'other', 0, 60), trackId: 't2' }] })

  const graph = buildAudioGraph(project, timeline, 0, 60, undefined, new Map([[low, 1], [high, 1], [other, 1]]))
  assert.ok(graph)
  const out = decode(FFMPEG, render(FFMPEG, graph.inputs, graph.filter, graph.outputLabel, join(dir, 'bus.wav'), 2))
  const bands = trackBusBands(timeline.tracks[0]) as BiquadSpec[]
  assert.equal(bands.length, 2)
  for (const f of [200, 3000]) {
    const measured = toneDb(out, f, RATE / 2, RATE) + 20
    assert.ok(Math.abs(measured - chainResponseDb(bands, f, RATE)) <= LEVEL_TOLERANCE_DB, `${f} Hz on the track: ${measured.toFixed(3)} dB, the chain ${chainResponseDb(bands, f, RATE).toFixed(3)} dB`)
  }
  const untouched = toneDb(out, 6000, RATE / 2, RATE) + 20
  assert.ok(Math.abs(untouched) <= LEVEL_TOLERANCE_DB, `the other track is not filtered (${untouched.toFixed(3)} dB)`)
  assert.ok(Math.abs(chainResponseDb(bands, 6000, RATE)) > 0.5, 'and would have read differently had it been')
})

test('a chain that does nothing writes the graph a clip with no chain writes', () => {
  const a = scene([asset('x', '/tmp/x.wav')], [clip('c', 'x', 0, 60, { fadeInFrames: 5 }), clip('d', 'x', 60, 30)])
  const idle: AudioEffect[] = [fx('bell', { gain: 0 }), { ...fx('highpass'), enabled: false }, fx('compressor', { ratio: 1 })]
  const b = scene([asset('x', '/tmp/x.wav')], [clip('c', 'x', 0, 60, { fadeInFrames: 5, audioEffects: idle }), clip('d', 'x', 60, 30)], { audioEffects: idle })
  const plain = buildAudioGraph(a.project, a.timeline, 0, 90)
  const withIdle = buildAudioGraph(b.project, b.timeline, 0, 90)
  assert.ok(plain && withIdle)
  assert.equal(withIdle.filter, plain.filter)
  assert.deepEqual(withIdle.inputs, plain.inputs)
  // The twin: one live band changes it.
  const c = scene([asset('x', '/tmp/x.wav')], [clip('c', 'x', 0, 60, { fadeInFrames: 5, audioEffects: [fx('bell', { gain: 2 })] }), clip('d', 'x', 60, 30)])
  assert.notEqual(buildAudioGraph(c.project, c.timeline, 0, 90)!.filter, plain.filter)
  assert.ok(BUTTERWORTH_Q > 0.7)
})
