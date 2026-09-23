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
import { existsSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { buildAudioGraph } from './audio-graph'

const require_ = createRequire(import.meta.url)
const FFMPEG = (require_('ffmpeg-ffprobe-static') as { ffmpegPath?: string | null }).ffmpegPath ?? ''
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
  { skip: existsSync(FFMPEG) ? false : `no bundled ffmpeg at "${FFMPEG}" — run pnpm install` },
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
