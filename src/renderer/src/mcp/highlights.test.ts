/**
 * `find_highlights` and `mark_highlights` through the real dispatcher. Run with `pnpm test`.
 *
 * What matters here is where the sentences land (this clip's in-point and position, not the
 * file's seconds), that a sentence the clip cuts in half is never offered, that the transcript
 * comes from the session cache `transcribe` fills, and that a bad pick places nothing and says why.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import type { TranscriptSegment } from '@shared/transcribe'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'
import { forgetTranscripts } from './transcribe'

beforeEach(() => forgetTranscripts())

const transcribed: string[] = []
/** What the stubbed whisper returns; a test may swap it for silence and must put it back. */
let whisperSays: TranscriptSegment[] = []
const SEGMENTS: TranscriptSegment[] = [
  { startSeconds: 0, endSeconds: 1.5, text: ' Before the clip.' },
  { startSeconds: 1.8, endSeconds: 3, text: ' Straddles the in-point.' },
  { startSeconds: 3, endSeconds: 5, text: ' First whole sentence.' },
  { startSeconds: 5.2, endSeconds: 8, text: ' Second whole' },
  { startSeconds: 8, endSeconds: 8.3, text: ' sentence.' },
  { startSeconds: 8.5, endSeconds: 11.5, text: ' Third one.' },
  { startSeconds: 11.8, endSeconds: 13, text: ' Straddles the out-point.' }
]
whisperSays = SEGMENTS

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      transcribe: async (path: string) => {
        transcribed.push(path)
        return { ok: true, segments: whisperSays, model: 'ggml-base.en.bin', language: 'en' }
      }
    }
  }
}

const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id,
  kind: 'video',
  name: `${id}.mp4`,
  path: `/footage/${id}.mp4`,
  durationUs: 60_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
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

/** In at 2s of its file, placed at frame 90 of a 30 fps timeline, playing ten seconds. */
const TALK = item('clip_talk', 'talk', 'v1', { from: 90, durationInFrames: 300, sourceStartUs: 2_000_000 })

function seed(withMusic = false): void {
  const base = emptyProject()
  const track = (id: string, kind: 'video' | 'audio', items: Item[]) => ({ id, kind, name: id, locked: false, muted: false, hidden: false, items })
  const project: Project = {
    ...base,
    assets: [asset('talk'), asset('music', { kind: 'audio', hasVideo: false })],
    timelines: base.timelines.map((timeline) => ({
      ...timeline,
      fps: 30,
      markers: [],
      tracks: [
        track('v1', 'video', [TALK]),
        track('a1', 'audio', withMusic ? [item('clip_music', 'music', 'a1', { from: 0, durationInFrames: 400 })] : [])
      ]
    }))
  }
  useEditor.getState().enterProject(project)
}

const call = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: 't', tool, args })

interface Found {
  sentences: { i: number; fromFrame: number; toFrame: number; text: string; itemId: string }[]
  droppedAtEdges: number
  bounds: { fromFrame: number; toFrame: number }
  rubric: { focus: { name: string }; durationSeconds: { min: number; max: number }; count: number; criteria: Record<string, string> }
}

test('sentences come back in timeline frames for this clip, and only the ones it plays whole', async () => {
  seed()
  const result = await call('find_highlights', { itemId: 'clip_talk', focus: 'knowledge', minSeconds: 15, maxSeconds: 45, count: 2 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as Found
  assert.deepEqual(
    value.sentences.map((s) => [s.fromFrame, s.toFrame, s.text]),
    [
      // 90 + (3 - 2) × 30 = 120: the clip's position and in-point both applied.
      [120, 180, 'First whole sentence.'],
      // Two whisper lines, one sentence.
      [186, 279, 'Second whole sentence.'],
      [285, 375, 'Third one.']
    ]
  )
  assert.equal(value.droppedAtEdges, 2, 'the two sentences the clip cuts in half are left out')
  assert.deepEqual(value.bounds, { fromFrame: 90, toFrame: 390 })
  assert.equal(value.rubric.focus.name, 'knowledge')
  assert.deepEqual(value.rubric.durationSeconds, { min: 15, max: 45 })
  assert.equal(value.rubric.count, 2)
  assert.deepEqual(Object.keys(value.rubric.criteria).sort(), ['completeness', 'emotion', 'hook', 'information'])
})

test('a transcript made by transcribe is reused, not made again', async () => {
  seed()
  transcribed.length = 0
  assert.ok((await call('transcribe', { itemId: 'clip_talk' })).ok)
  assert.equal(transcribed.length, 1, 'positive control: transcribe itself ran whisper')
  assert.ok((await call('find_highlights', { itemId: 'clip_talk' })).ok)
  assert.equal(transcribed.length, 1, 'find_highlights read the session cache')
})

test('a range alone finds the one speech clip under it; two sounding at once are refused by name', async () => {
  seed()
  const ranged = await call('find_highlights', { fromFrame: 100, toFrame: 300 })
  assert.ok(ranged.ok, ranged.ok ? '' : ranged.error)
  assert.deepEqual((ranged.value as Found).sentences.map((s) => s.text), ['First whole sentence.', 'Second whole sentence.'])

  seed(true)
  const refused = await call('find_highlights', { fromFrame: 100, toFrame: 300 })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /clip_music and clip_talk|clip_talk and clip_music/)
  assert.match(refused.ok ? '' : refused.error, /Pass the speech clip's itemId/)
  // Positive control: naming the clip gets past the ambiguity.
  assert.ok((await call('find_highlights', { itemId: 'clip_talk', fromFrame: 100, toFrame: 300 })).ok)
})

test('a file’s sentences come back in its own seconds', async () => {
  seed()
  const result = await call('find_highlights', { assetId: 'talk' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { sentences: { startSeconds: number; text: string }[]; units: string }
  assert.equal(value.sentences.length, 6, 'every sentence in the file, the straddlers included')
  assert.equal(value.sentences[0]!.startSeconds, 0)
  assert.match(value.units, /seconds/)
})

const markers = (): { frame: number; label: string }[] => useEditor.getState().project.timelines[0]!.markers ?? []

test('bad picks place nothing and every fault is named', async () => {
  seed()
  const result = await call('mark_highlights', {
    highlights: [
      { title: 'One', fromFrame: 120, toFrame: 279 },
      { title: 'Two', fromFrame: 186, toFrame: 375 },
      { title: 'Three', fromFrame: 300, toFrame: 900 }
    ]
  })
  assert.equal(result.ok, false)
  const error = result.ok ? '' : result.error
  assert.match(error, /No markers were placed/)
  assert.match(error, /"Two".*overlaps.*"One"/)
  assert.match(error, /"Three".*outside the material, frames 0–390/)
  assert.equal(markers().length, 0)
})

test('good picks become ranked start and end markers in one step', async () => {
  seed()
  const before = useEditor.getState().past.length
  const result = await call('mark_highlights', {
    focus: 'viral',
    minSeconds: 2,
    maxSeconds: 5,
    highlights: [
      { title: 'Calm point', fromFrame: 120, toFrame: 180, scores: { hook: 30, information: 90, emotion: 20, completeness: 90 } },
      { title: 'Big reaction', fromFrame: 285, toFrame: 375, scores: { hook: 95, information: 30, emotion: 95, completeness: 60 } }
    ]
  })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { highlights: { rank: number; title: string; score: number }[] }
  assert.deepEqual(value.highlights.map((h) => [h.rank, h.title]), [[1, 'Big reaction'], [2, 'Calm point']], 'ranked by the viral weighting')
  assert.deepEqual(
    markers().map((m) => [m.frame, m.label]).sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [120, `H2 Calm point (${value.highlights[1]!.score})`],
      [180, 'H2 end'],
      [285, `H1 Big reaction (${value.highlights[0]!.score})`],
      [375, 'H1 end']
    ]
  )
  assert.equal(useEditor.getState().past.length - before, 1)

  seed()
  assert.ok((await call('mark_highlights', { ends: false, highlights: [{ title: 'Only starts', fromFrame: 120, toFrame: 180 }] })).ok)
  assert.deepEqual(markers().map((m) => m.frame), [120])
})

test('a clip with no speech says so, as transcribe would; a clip with speech carries no finding', async () => {
  seed()
  const spoken = (await call('find_highlights', { itemId: 'clip_talk' })) as { ok: boolean; value?: Record<string, unknown> }
  assert.ok(spoken.ok)
  assert.equal(spoken.value?.findings, undefined, 'positive control: speech yields no finding')

  forgetTranscripts()
  whisperSays = []
  try {
    const silent = await call('find_highlights', { itemId: 'clip_talk' })
    assert.ok(silent.ok, silent.ok ? '' : silent.error)
    const value = silent.value as { findings?: { severity: string; message: string }[]; next: string }
    assert.equal(value.findings?.[0]?.severity, 'blocking')
    assert.match(value.next, /No speech was found/)
  } finally {
    whisperSays = SEGMENTS
    forgetTranscripts()
  }
})
