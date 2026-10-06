/**
 * Dynamics: the preview path and the export path produce the same samples.
 *
 * **Which path each side is.** Export is real end to end: `bakesNeeded` → `AudioFxBaker` (bay's
 * ffmpeg) → `buildAudioGraph` → bay's ffmpeg → the file's samples.
 *
 * The preview side is in two links, because the suite's two halves cannot import each other.
 * This file plays the *rule* the preview follows — the clip's processed file once it is ready
 * (its own file until then), at the frame's source time (`sourceTimeAt`), times the shared gain
 * (`itemAudioGainAt`), through the plan's live bands by the Web Audio specification's arithmetic
 * — and compares that with the export, sample by sample. That the engine's routing *is* that rule
 * (that file, that position, that gain, those bands) is pinned in
 * `renderer/src/engine/audio-effects.test.ts`. Neither is a browser: that Chromium plays the file
 * the routing names is `test/app/audio-effects.mjs`, in the running app.
 *
 * The specimen has a loud and a quiet section, so the compressor is working in one and idle in
 * the other, and a difference in either would show.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceTimeAt, type Asset, type Item, type Project, type Timeline } from '@shared/project'
import { itemAudioGainAt } from '@shared/audio-gain'
import { defaultEffect, itemEffectPlan, webAudioBiquad, type AudioEffect, type AudioEffectKind } from '@shared/audio-effects'
import type { AudioBakeLookup, AudioBakeState } from '@shared/audio-bake'
import { bakesNeeded, buildAudioGraph } from '../export/audio-graph'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { AudioFxBaker } from './bake'
import { RATE, decode, nodeFilter, render, rmsDb, synth, toneDb } from './specimen'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG
const FPS = 30
const PER_FRAME = RATE / FPS

/** Stated: the two paths agree to −80 dBFS on every sample. */
const SAMPLE_TOLERANCE = 1e-4

const fx = (kind: AudioEffectKind, params: Record<string, number> = {}): AudioEffect => {
  const base = defaultEffect(kind, kind)
  return { ...base, params: { ...base.params, ...params } }
}

function scene(path: string, chain: AudioEffect[], trackChain?: AudioEffect[]): { project: Project; timeline: Timeline; item: Item } {
  const asset: Asset = { id: 'voice', kind: 'audio', name: 'voice.wav', path, durationUs: 6_000_000, width: 0, height: 0, fps: null, hasAudio: true, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0 }
  // Starts half a second into the source and half a second into the timeline, at a level of 0.8.
  const item: Item = {
    id: 'clip', assetId: 'voice', trackId: 't', from: 15, durationInFrames: 120, sourceStartUs: 500_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 0.8, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, audioEffects: chain
  }
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: FPS, width: 1920, height: 1080, background: '#000000', transitions: [],
    tracks: [{ id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [item], ...(trackChain ? { audioEffects: trackChain } : {}) }]
  }
  return { item, timeline, project: { id: 'p', name: 'p', version: 1, assets: [asset], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 } }
}

/**
 * What the preview puts out for the one clip of `timeline`, by the rule in the header: per frame,
 * the file (processed when `lookup` says ready), the source time, the gain and the live bands.
 */
function previewSamples(project: Project, timeline: Timeline, lookup: AudioBakeLookup | undefined, frames: number): Float32Array {
  const out = new Float32Array(frames * PER_FRAME)
  const track = timeline.tracks[0]!
  const item = track.items[0]!
  const source = project.assets[0]!.path!
  const plan = itemEffectPlan(track, item)
  let filePath = ''
  let filtered: Float32Array | null = null
  for (let frame = item.from; frame < Math.min(frames, item.from + item.durationInFrames); frame += 1) {
    const state = plan.bake.length > 0 && lookup ? lookup(source, plan.bake) : null
    const path = state?.state === 'ready' ? state.path : source
    const start = Math.round((sourceTimeAt(item, frame, FPS) / 1e6) * RATE)
    if (path !== filePath) {
      filePath = path
      // The element plays the file; the nodes after it hear it from the clip's first sample on.
      const file = decode(FFMPEG, path)
      let heard: Float32Array = file.slice(start)
      for (const band of plan.clip) heard = nodeFilter(webAudioBiquad(band), heard)
      filtered = new Float32Array(file.length)
      filtered.set(heard, start)
    }
    const gain = itemAudioGainAt(project, timeline, item, frame)
    for (let i = 0; i < PER_FRAME; i += 1) out[frame * PER_FRAME + i] = (filtered![start + i] ?? 0) * gain
  }
  return out
}

function worstDifference(a: Float32Array, b: Float32Array, from: number, to: number): number {
  let worst = 0
  for (let i = from; i < to; i += 1) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)))
  return worst
}

test('a compressed clip: the samples the preview routing plays are the samples in the exported file', { skip: SKIP, timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-afx-parity-'))
  // Loud for three seconds (−4 dBFS peak), then quiet (−32): over the threshold, then under it.
  const source = synth(FFMPEG, dir, 'voice', '(0.63*lt(t,3)+0.025*gte(t,3))*(0.7*sin(2*PI*220*t)+0.3*sin(2*PI*3100*t))', 6)
  // A band before the compressor (baked with it), the compressor, and a band after it (live).
  const chain = [fx('highpass', { frequency: 100 }), fx('compressor', { threshold: -20, ratio: 4, makeup: 3 }), fx('bell', { frequency: 3000, gain: 4, q: 1.2 })]
  const { project, timeline, item } = scene(source, chain)

  const needs = bakesNeeded(project, timeline, 0, 150)
  assert.deepEqual(needs.map((n) => [n.itemId, n.path, n.effects.map((e) => e.kind)]), [['clip', source, ['highpass', 'compressor']]])
  const baker = new AudioFxBaker({ dir: join(dir, 'bakes'), ffmpeg: () => FFMPEG, isAllowed: () => true })
  const bake = await baker.ensure({ path: needs[0]!.path, effects: needs[0]!.effects })
  assert.ok(bake.ok, bake.ok ? '' : bake.error)

  // Export.
  const bakes = new Map([[item.id, bake.path]])
  const graph = buildAudioGraph(project, timeline, 0, 150, undefined, new Map([[bake.path, 1]]), bakes)
  assert.ok(graph)
  assert.deepEqual(graph.inputs, [bake.path], 'export reads the processed file, not the source')
  const exported = decode(FFMPEG, render(FFMPEG, graph.inputs, graph.filter, graph.outputLabel, join(dir, 'export.wav'), 5))

  // Preview, once the bake is ready.
  const asked: string[] = []
  const ready: AudioBakeLookup = (path, effects): AudioBakeState => {
    asked.push(`${path}|${effects.map((e) => e.kind).join(',')}`)
    return { state: 'ready', key: bake.key, path: bake.path }
  }
  const previewed = previewSamples(project, timeline, ready, 150)
  assert.ok(asked.every((a) => a === `${source}|highpass,compressor`), 'the preview asks for the bake export renders')

  // The clip sounds from frame 15 to 135; compare all of it, loud section and quiet.
  const from = 15 * PER_FRAME
  const to = 135 * PER_FRAME
  const worst = worstDifference(previewed, exported, from, to)
  assert.ok(worst <= SAMPLE_TOLERANCE, `preview and export differ by ${worst} at most (stated tolerance ${SAMPLE_TOLERANCE})`)
  assert.ok(worstDifference(previewed, exported, 0, from) <= SAMPLE_TOLERANCE, 'and both are silent before the clip')

  // The specimen is one the chain works on: loud is reduced, quiet is raised by the make-up.
  const dry = decode(FFMPEG, source)
  const loudIn = rmsDb(dry, 1.5 * RATE, RATE)
  const loudOut = rmsDb(exported, 1.5 * RATE, RATE) - 20 * Math.log10(0.8)
  // The clip ends at 4.5 s, so the quiet second measured is 3.4–4.4 s (source and timeline agree).
  const quietIn = toneDb(dry, 220, 3.4 * RATE, RATE)
  const quietOut = toneDb(exported, 220, 3.4 * RATE, RATE) - 20 * Math.log10(0.8)
  assert.ok(loudIn - loudOut > 4, `the loud section is compressed (${loudIn.toFixed(1)} → ${loudOut.toFixed(1)} dB RMS)`)
  assert.ok(quietOut - quietIn > 2 && quietOut - quietIn < 4, `the quiet section only gains the make-up (${(quietOut - quietIn).toFixed(2)} dB)`)

  // And the comparison can fail: while the bake is pending the preview plays the unprocessed
  // sound, which is not what is in the file.
  const pending = previewSamples(project, timeline, () => ({ state: 'pending' }), 150)
  assert.ok(worstDifference(pending, exported, from, to) > 1000 * SAMPLE_TOLERANCE, 'the unprocessed preview is a different sound')
})

test('a track’s dynamics reach each clip’s processed file, in both paths', { skip: SKIP, timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-afx-parity-track-'))
  const source = synth(FFMPEG, dir, 'voice', '(0.63*lt(t,3)+0.025*gte(t,3))*sin(2*PI*220*t)', 6)
  const { project, timeline, item } = scene(source, [fx('highpass', { frequency: 90 })], [fx('limiter', { ceiling: -12 }), fx('highshelf', { gain: -3 })])
  const needs = bakesNeeded(project, timeline, 0, 150)
  assert.deepEqual(needs[0]!.effects.map((e) => e.kind), ['highpass', 'limiter'], 'the clip’s band, then the track’s limiter')
  const baker = new AudioFxBaker({ dir: join(dir, 'bakes'), ffmpeg: () => FFMPEG, isAllowed: () => true })
  const bake = await baker.ensure(needs[0]!)
  assert.ok(bake.ok, bake.ok ? '' : bake.error)
  const graph = buildAudioGraph(project, timeline, 0, 150, undefined, new Map([[bake.path, 1]]), new Map([[item.id, bake.path]]))
  assert.ok(graph)
  assert.match(graph.filter, /highshelf=/, 'the band after the track’s limiter runs on the bus')
  assert.doesNotMatch(graph.filter, /alimiter|highpass=/, 'and the baked stages are not filters in the mix')
  const exported = decode(FFMPEG, render(FFMPEG, graph.inputs, graph.filter, graph.outputLabel, join(dir, 'export.wav'), 5))
  // −12 dB ceiling, the clip's 0.8, and the shelf leaves 220 Hz alone: the loud section peaks there.
  const peak = toneDb(exported, 220, 1.5 * RATE, RATE)
  assert.ok(Math.abs(peak - (-12 + 20 * Math.log10(0.8))) < 0.3, `the loud section sits at the ceiling times the clip's level (${peak.toFixed(2)} dB)`)
  assert.deepEqual(itemEffectPlan(timeline.tracks[0], item).clip, [], 'nothing of the clip is live')
  const previewed = previewSamples(project, timeline, () => ({ state: 'ready', key: bake.key, path: bake.path }), 150)
  // The bus's shelf is not in `previewSamples` (it models the clip's own path), and it leaves
  // 220 Hz alone, so the two still agree at the tone.
  assert.ok(Math.abs(toneDb(previewed, 220, 1.5 * RATE, RATE) - peak) < 0.05, 'the preview rule plays the same level')
})

test('an export without a clip’s processed file stops, naming the clip and what was not rendered', () => {
  const { project, timeline, item } = scene('/tmp/voice.wav', [fx('gate'), fx('denoise')])
  assert.throws(
    () => buildAudioGraph(project, timeline, 0, 150),
    (error: Error) => /processed sound for clip clip \(gate, denoise\) was not rendered/.test(error.message) && /unprocessed sound/.test(error.message)
  )
  // The twin: with the file, it builds; and a clip with no baked stage never needed one.
  assert.ok(buildAudioGraph(project, timeline, 0, 150, undefined, undefined, new Map([[item.id, '/tmp/baked.wav']])))
  const plain = scene('/tmp/voice.wav', [fx('highpass')])
  assert.ok(buildAudioGraph(plain.project, plain.timeline, 0, 150))
  assert.deepEqual(bakesNeeded(plain.project, plain.timeline, 0, 150), [])
  // A muted track's clips are not in the graph, so their bakes are not asked for either.
  timeline.tracks[0]!.muted = true
  assert.deepEqual(bakesNeeded(project, timeline, 0, 150), [])
  assert.equal(buildAudioGraph(project, timeline, 0, 150), null)
})
