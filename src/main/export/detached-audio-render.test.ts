/**
 * Detached audio, rendered by the real ffmpeg and measured in the file (EXPORT).
 *
 * The requirement: a picture fade-out on a clip whose sound was detached fades the picture only —
 * the sound stays at full level to the cut — and the clip's file is decoded for sound once, not
 * once for the picture item and again for the audio item. The control is the same timeline before
 * the detach, where the fade takes the sound down with it; without it, "full level at the end"
 * could be a graph that ignores fades altogether.
 *
 * The picture half of the fade is the compositor's and is measured in the app probe
 * (`test/app/detach-audio.mjs`); this is the sound half, in the file.
 *
 * Skips loudly when the bundled ffmpeg is absent, because a check that cannot run must not read
 * as a pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Asset, Item, Project, Timeline, Track } from '@shared/project'
import { detachAudio } from '@shared/links'
import { buildAudioGraph } from './audio-graph'
import { vendoredTools } from '../ffmpeg/vendor'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const RATE = 48_000
const FPS = 30
const PER_FRAME = RATE / FPS

function rmsAt(samples: Int16Array, frame: number): number {
  let sum = 0
  for (let i = 0; i < PER_FRAME; i += 1) {
    const s = (samples[frame * PER_FRAME + i] ?? 0) / 32768
    sum += s * s
  }
  return Math.sqrt(sum / PER_FRAME)
}

function render(project: Project, timeline: Timeline, dir: string, name: string): { samples: Int16Array; inputs: number } {
  const graph = buildAudioGraph(project, timeline, 0, 90)
  assert.ok(graph, 'an audible clip must produce a graph')
  const out = join(dir, `${name}.wav`)
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    ...graph.inputs.flatMap((path) => ['-i', path]),
    '-filter_complex', graph.filter,
    '-map', `[${graph.outputLabel}]`, '-t', '3', '-ac', '1', '-ar', String(RATE), out
  ])
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', out, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'])
  return { samples: new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2)), inputs: graph.inputs.length }
}

test(
  'a detached clip\'s picture fade leaves its sound at full level in the file, from one decode',
  { skip: existsSync(FFMPEG) ? false : `no bundled ffmpeg at "${FFMPEG}" — run pnpm install`, timeout: 60_000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'bay-detach-'))
    const movie = join(dir, 'shot.mp4')
    execFileSync(FFMPEG, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
      '-c:v', 'h264_videotoolbox', '-q:v', '90', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', movie
    ])
    const asset: Asset = {
      id: 'shot', kind: 'video', name: 'shot.mp4', path: movie, durationUs: 5_000_000,
      width: 320, height: 180, fps: FPS, hasAudio: true, hasVideo: true,
      posterPath: null, waveformPath: null, createdAt: 0
    }
    const picture: Item = {
      id: 'pic', assetId: 'shot', trackId: 'v1', from: 0, durationInFrames: 90, sourceStartUs: 0,
      layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
      volume: 1, fadeInFrames: 0, fadeOutFrames: 30, speed: 1
    }
    const timeline: Timeline = {
      id: 'tl', name: 'T', fps: FPS, width: 1920, height: 1080, background: '#000',
      tracks: [{ id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [picture] }]
    }
    const project: Project = {
      id: 'p', name: 'p', version: 1, assets: [asset], timelines: [timeline],
      activeTimelineId: 'tl', createdAt: 0, updatedAt: 0
    }

    // Control: attached, the picture's fade-out is the sound's too.
    const attached = render(project, timeline, dir, 'attached')
    const full = rmsAt(attached.samples, 30)
    assert.ok(full > 0.03, `specimen: the tone is there (${full})`)
    assert.ok(rmsAt(attached.samples, 85) < full * 0.25, `attached: faded by frame 85 (${rmsAt(attached.samples, 85)} vs ${full})`)

    let n = 0
    const result = detachAudio(project, timeline, ['pic'], {
      makeId: (prefix) => `${prefix}_${++n}`,
      makeAudioTrack: (): Track => ({ id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [] })
    })
    assert.equal(result.detached.length, 1)
    // The sound took the fade with it (detach is audibly a no-op); take it off the sound only,
    // leaving the picture's 30-frame fade-out in place.
    const audio = timeline.tracks.find((t) => t.id === 'a1')!.items[0]!
    audio.fadeOutFrames = 0
    assert.equal(picture.fadeOutFrames, 30, 'specimen: the picture still fades out')

    const detached = render(project, timeline, dir, 'detached')
    assert.equal(detached.inputs, 1, 'the file is opened once for sound — the audio item, not the picture as well')
    for (const frame of [30, 70, 85, 88]) {
      const level = rmsAt(detached.samples, frame)
      assert.ok(Math.abs(level - full) / full < 0.05, `frame ${frame}: ${level} against full ${full}`)
    }
  }
)
