/**
 * `detect_beats` and the `markers` form of `add_marker`, through the executor.
 *
 * What is held still: the beats come back in timeline frames mapped through *this clip* (a tool
 * that returned the file's seconds, or mapped against the wrong clip, would put every cut off
 * the beat with nothing reporting it); the grid is kept on the asset and not re-analysed; the
 * suggested markers go into add_marker in one call and come out in one undo step; and each
 * refusal says what to do instead. The analysis itself is `beat-analysis.test.ts`.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { BeatGrid } from '@shared/beats'
import type { Asset, Item, Project } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { executeToolCall } from './index'

/** 120 BPM from 0.5 s: a beat every 0.5 s, a downbeat every fourth, drums out 10-12 s. */
const GRID: BeatGrid = {
  version: 1,
  bpm: 120,
  confidence: 0.9,
  beatsPerBar: 4,
  beatsUs: Array.from({ length: 50 }, (_, i) => 500_000 + i * 500_000),
  downbeatsUs: Array.from({ length: 13 }, (_, i) => 500_000 + i * 2_000_000),
  downbeatConfidence: 0.4,
  dropouts: [{ startUs: 10_000_000, endUs: 12_000_000, kind: 'percussion' }]
}

const asked: { path: string; beatsPerBar: number | undefined }[] = []
;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      beats: async (path: string, options?: { beatsPerBar?: number }) => {
        asked.push({ path, beatsPerBar: options?.beatsPerBar })
        return { ok: true, grid: { ...GRID, beatsPerBar: options?.beatsPerBar ?? 4 } }
      }
    }
  }
}

const asset = (id: string, extra: Partial<Asset>): Asset => ({
  id,
  kind: 'audio',
  name: `${id}.wav`,
  path: `/music/${id}.wav`,
  durationUs: 60_000_000,
  width: null,
  height: null,
  fps: null,
  hasAudio: true,
  hasVideo: false,
  posterPath: null,
  waveformPath: null,
  createdAt: 0,
  ...extra
})

const item = (id: string, assetId: string, trackId: string, extra: Partial<Item>): Item => ({
  id,
  assetId,
  trackId,
  from: 0,
  durationInFrames: 60,
  sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
  volume: 1,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  speed: 1,
  ...extra
})

/** The song enters at frame 60, from 2.0 s of the file, for 12 s (to 14 s of the file). */
const SONG = item('clip_song', 'song', 'a1', { from: 60, durationInFrames: 360, sourceStartUs: 2_000_000 })

beforeEach(() => {
  asked.length = 0
  const base = emptyProject()
  const project: Project = {
    ...base,
    assets: [asset('song', {}), asset('silent', { kind: 'video', hasAudio: false, hasVideo: true })],
    timelines: base.timelines.map((timeline) => ({
      ...timeline,
      fps: 30,
      tracks: [
        { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [item('clip_shot', 'silent', 'v1', {})] },
        { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [SONG] }
      ]
    }))
  }
  useEditor.getState().enterProject(project)
})

const run = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: 't', tool, args })

async function refusal(tool: string, args: Record<string, unknown>): Promise<string> {
  const result = await run(tool, args)
  assert.equal(result.ok, false, `expected ${tool} ${JSON.stringify(args)} to be refused`)
  return result.ok ? '' : result.error
}

test('beats come back in timeline frames, mapped through the clip’s position and in-point', async () => {
  const result = await run('detect_beats', { itemId: 'clip_song' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { bpm: number; beats: number[]; downbeats: number[]; dropouts: unknown[]; framesPerBeat: number }
  assert.equal(value.bpm, 120)
  // Source 2.0 s is frame 60; beats every 15 frames to the last one the clip plays (13.5 s → 405).
  assert.equal(value.beats[0], 60)
  assert.equal(value.beats[1], 75)
  assert.equal(value.beats[value.beats.length - 1], 405)
  assert.equal(value.beats.length, 24)
  // Downbeats of the file at 2.5, 4.5 … s: the first one the clip plays is 2.5 s → frame 75.
  assert.deepEqual(value.downbeats.slice(0, 2), [75, 135])
  // The drums drop 10-12 s of the file → frames 300-360.
  assert.deepEqual(value.dropouts, [{ startFrame: 300, endFrame: 360, kind: 'percussion' }])
  assert.equal(value.framesPerBeat, 15)
  assert.deepEqual(asked, [{ path: '/music/song.wav', beatsPerBar: 4 }])
})

test('the grid is kept on the asset, silently, and not analysed twice', async () => {
  const pastBefore = useEditor.getState().past.length
  await run('detect_beats', { itemId: 'clip_song' })
  const song = useEditor.getState().project.assets.find((a) => a.id === 'song')
  assert.equal(song?.beats?.bpm, 120)
  assert.equal(useEditor.getState().past.length, pastBefore, 'caching a grid is not an edit and must not be an undo step')
  await run('detect_beats', { assetId: 'song' })
  assert.equal(asked.length, 1, 'the second call re-ran the analysis the asset already holds')
  // A different bar length is a different question.
  await run('detect_beats', { assetId: 'song', beatsPerBar: 3 })
  assert.equal(asked.length, 2)
})

test('the suggested markers go into add_marker in one call and come out in one undo step', async () => {
  const detected = await run('detect_beats', { itemId: 'clip_song', markers: 'downbeats' })
  assert.ok(detected.ok, detected.ok ? '' : detected.error)
  const markers = (detected.value as { markers: { frame: number; label: string; color?: string }[] }).markers
  // Downbeats the clip plays: 2.5, 4.5, 6.5, 8.5, 10.5, 12.5 s → bars 2-7 of the song; plus the drop.
  assert.deepEqual(
    markers.map((m) => [m.frame, m.label]),
    [[75, 'Bar 2'], [135, 'Bar 3'], [195, 'Bar 4'], [255, 'Bar 5'], [300, 'Drums out'], [315, 'Bar 6'], [375, 'Bar 7']]
  )
  const past = useEditor.getState().past.length
  const placed = await run('add_marker', { markers })
  assert.ok(placed.ok, placed.ok ? '' : placed.error)
  const timeline = useEditor.getState().project.timelines[0]!
  assert.deepEqual(timeline.markers?.map((m) => m.frame), [75, 135, 195, 255, 300, 315, 375])
  assert.equal(timeline.markers?.find((m) => m.frame === 300)?.color, '#E5484D')
  assert.equal(useEditor.getState().past.length, past + 1, 'seven markers must be one undo step')
  useEditor.getState().undo()
  assert.equal(useEditor.getState().project.timelines[0]!.markers?.length ?? 0, 0)
})

test('beats labels count bar.beat from the song’s first downbeat', async () => {
  const detected = await run('detect_beats', { itemId: 'clip_song', markers: 'beats' })
  assert.ok(detected.ok)
  const labels = (detected.value as { markers: { frame: number; label: string }[] }).markers.slice(0, 5)
  // Frame 60 is source 2.0 s: the 4th beat of bar 1 (bar 1 starts at 0.5 s).
  assert.deepEqual(labels.map((m) => [m.frame, m.label]), [[60, '1.4'], [75, '2.1'], [90, '2.2'], [105, '2.3'], [120, '2.4']])
})

test('a bad entry refuses the whole markers call, and places none of it', async () => {
  const error = await refusal('add_marker', { markers: [{ frame: 10 }, { frame: 20, color: 'red' }] })
  assert.match(error, /markers\[1\]\.color must be a hex colour/)
  assert.equal(useEditor.getState().project.timelines[0]!.markers?.length ?? 0, 0)
  // Its positive control: the same list with a legal colour is placed.
  const ok = await run('add_marker', { markers: [{ frame: 10 }, { frame: 20, color: '#FF0000' }] })
  assert.ok(ok.ok, ok.ok ? '' : ok.error)
  assert.equal(useEditor.getState().project.timelines[0]!.markers?.length, 2)
})

test('refusals say what to do instead', async () => {
  assert.match(await refusal('detect_beats', {}), /itemId .* or assetId/)
  assert.match(await refusal('detect_beats', { itemId: 'clip_shot' }), /no audio track/)
  assert.match(await refusal('detect_beats', { assetId: 'song', markers: 'beats' }), /markers needs itemId/)
  assert.match(await refusal('add_marker', { frame: 3, markers: [{ frame: 4 }] }), /either markers .* or frame/)
})
