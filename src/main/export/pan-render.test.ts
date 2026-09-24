/**
 * Pan in the exported file: the filter export writes, and what the ffmpeg bay ships does with it.
 *
 * The law is `panGains` (`@shared/audio-gain`); the preview's routing carries the same numbers
 * (`engine/audio-pan.test.ts`). This file checks the other path — a probe of the preview is not a
 * probe of the export — by rendering panned clips through the real ffmpeg and measuring each
 * channel against an unpanned render of the same clip.
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
import { panGains } from '@shared/audio-gain'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { buildAudioGraph, panFilter } from './audio-graph'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG
const RATE = 48_000
const FPS = 30
const PER_FRAME = RATE / FPS

function clip(extra: Partial<Item> = {}): Item {
  return {
    id: 'c', assetId: 'src', trackId: 't', from: 0, durationInFrames: 60, sourceStartUs: 0,
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
    id: 'src', kind: 'audio', name: 'src', path, durationUs: 10_000_000, width: 0, height: 0, fps: null,
    hasAudio: true, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0
  }
  return {
    timeline,
    project: { id: 'p', name: 'p', version: 1, assets: [asset], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }
  }
}

/** The filter's two coefficients, read back out of the string export writes. */
function coefficients(filter: string): { left: number; right: number } {
  const match = /^pan=stereo\|c0=([\d.]+)\*c0\|c1=([\d.]+)\*c1$/.exec(filter)
  assert.ok(match, `a pan filter of the expected shape: ${filter}`)
  return { left: Number(match[1]), right: Number(match[2]) }
}

test('the pan filter is panGains, coefficient for coefficient, and centre writes no filter', () => {
  assert.equal(panFilter(undefined), null)
  assert.equal(panFilter(0), null)
  for (const pan of [-1, -0.5, -0.1, 0.3, 0.75, 1]) {
    const written = coefficients(panFilter(pan)!)
    const law = panGains(pan)
    assert.ok(Math.abs(written.left - law.left) < 1e-6 && Math.abs(written.right - law.right) < 1e-6, `pan ${pan}`)
  }
  // And it is in the graph, after the stereo up-mix; an unpanned clip's graph has none.
  const panned = setup('/tmp/x.wav', clip({ pan: -0.5 }))
  const graph = buildAudioGraph(panned.project, panned.timeline, 0, 60)!
  assert.ok(graph.filter.includes(panFilter(-0.5)!), graph.filter)
  assert.ok(graph.filter.indexOf('channel_layouts=stereo') < graph.filter.indexOf('pan='), 'up-mix first')
  const plain = setup('/tmp/x.wav', clip())
  assert.ok(!buildAudioGraph(plain.project, plain.timeline, 0, 60)!.filter.includes('pan='))
})

/** Mixes `item` through the real ffmpeg; returns interleaved stereo samples. */
function render(dir: string, path: string, item: Item): Int16Array {
  const { project, timeline } = setup(path, item)
  const graph = buildAudioGraph(project, timeline, 0, 60)
  assert.ok(graph)
  const out = join(dir, `mix-${Math.random().toString(36).slice(2)}.wav`)
  execFileSync(FFMPEG, [
    '-v', 'error', '-y', ...graph.inputs.flatMap((p) => ['-i', p]),
    '-filter_complex', graph.filter, '-map', '[aout]', '-t', '2', '-ac', '2', '-ar', String(RATE), out
  ])
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', out, '-f', 's16le', '-ac', '2', '-ar', String(RATE), '-'])
  return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
}

/** Amplitude of `frequency` in one channel (0 left, 1 right) over frame 30 (Goertzel). */
function level(samples: Int16Array, channel: 0 | 1, frequency: number): number {
  const n = PER_FRAME
  const start = 30 * n
  const w = (2 * Math.PI * Math.round((n * frequency) / RATE)) / n
  const c = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i += 1) {
    const s0 = (samples[(start + i) * 2 + channel] ?? 0) / 32768 + c * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (n / 2)
}

const db = (ratio: number): number => 20 * Math.log10(ratio)

test('a dual-mono clip panned through the real ffmpeg: each channel moves by the law, within 0.05 dB', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-pan-'))
  const path = join(dir, 'tone.wav')
  // Quiet enough that +3 dB on one side cannot clip the 16-bit render.
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=4', '-af', 'volume=0.25', '-ac', '2', '-ar', String(RATE), path])
  const reference = render(dir, path, clip())
  const refLeft = level(reference, 0, 500)
  const refRight = level(reference, 1, 500)
  assert.ok(refLeft > 0.01 && Math.abs(db(refLeft / refRight)) < 0.01, `the unpanned render is centred (${refLeft}, ${refRight})`)

  for (const pan of [-0.5, 0.3, 0.8]) {
    const samples = render(dir, path, clip({ pan }))
    const law = panGains(pan)
    const left = db(level(samples, 0, 500) / refLeft)
    const right = db(level(samples, 1, 500) / refRight)
    assert.ok(Math.abs(left - db(law.left)) < 0.05, `pan ${pan}: left ${left.toFixed(3)} dB, law ${db(law.left).toFixed(3)} dB`)
    assert.ok(Math.abs(right - db(law.right)) < 0.05, `pan ${pan}: right ${right.toFixed(3)} dB, law ${db(law.right).toFixed(3)} dB`)
  }
  const hardLeft = render(dir, path, clip({ pan: -1 }))
  assert.ok(Math.abs(db(level(hardLeft, 0, 500) / refLeft) - 3.0103) < 0.05, 'hard left is +3 dB on the left')
  assert.ok(level(hardLeft, 1, 500) < refRight * 1e-3, 'and silence on the right')
})

test('a stereo source pans as a balance: hard left drops the right channel, it does not fold it across', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-pan-stereo-'))
  const path = join(dir, 'lr.wav')
  // 440 Hz on the left only, 880 Hz on the right only.
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4',
    '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo,volume=0.25', '-ar', String(RATE), path
  ])
  const reference = render(dir, path, clip())
  assert.ok(level(reference, 0, 440) > 0.01 && level(reference, 1, 880) > 0.01, 'the specimen has one tone per side')
  assert.ok(level(reference, 1, 440) < 1e-3, 'and the left tone is not on the right before panning')

  const panned = render(dir, path, clip({ pan: -1 }))
  assert.ok(level(panned, 1, 880) < 1e-3, 'the right tone is gone')
  assert.ok(level(panned, 0, 880) < 1e-3, 'and has not been moved to the left')
  assert.ok(Math.abs(db(level(panned, 0, 440) / level(reference, 0, 440)) - 3.0103) < 0.05, 'the left tone is +3 dB')
})

test('a mono source pans as a point: its two up-mixed channels take the law between them', { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-pan-mono-'))
  const path = join(dir, 'mono.wav')
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=4', '-af', 'volume=0.25', '-ac', '1', '-ar', String(RATE), path])
  const reference = render(dir, path, clip())
  // Both channels carry the mono signal equally before the pan.
  assert.ok(Math.abs(db(level(reference, 0, 500) / level(reference, 1, 500))) < 0.01)
  const pan = -0.4
  const samples = render(dir, path, clip({ pan }))
  const law = panGains(pan)
  const measured = db(level(samples, 0, 500) / level(samples, 1, 500))
  assert.ok(Math.abs(measured - db(law.left / law.right)) < 0.05, `L−R ${measured.toFixed(3)} dB, law ${db(law.left / law.right).toFixed(3)} dB`)
})
