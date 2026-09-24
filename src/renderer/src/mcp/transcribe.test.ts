/**
 * The `transcribe` tool: what it sends the transcriber, and where the lines come back. Run with
 * `pnpm test`.
 *
 * The mapping itself is `segmentsToCues`, tested in `src/shared/transcribe.test.ts`. What is
 * tested here is that the tool actually applies it with *this clip's* in-point, speed and
 * position — a tool that returned the file's seconds, or mapped against the wrong clip, would
 * put every caption in the wrong place with nothing reporting a fault — and that each refusal
 * says what to do instead.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import { segmentsToCues, type TranscriptSegment } from '@shared/transcribe'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'
import { anyTranscriptFor, cachedTranscript, forgetTranscripts } from './transcribe'

// Each case answers the same file its own way; the session cache would hand back the first.
beforeEach(() => forgetTranscripts())

type TranscribeResult =
  | { ok: true; segments: TranscriptSegment[]; model: string; language: string }
  | { ok: false; error: string }

interface Sent {
  path: string
  language: string | undefined
  options: { download?: boolean; model?: string | null } | undefined
}

const sent: Sent[] = []
let answer: TranscribeResult

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      transcribe: async (path: string, language?: string, options?: Sent['options']) => {
        sent.push({ path, language, options })
        return answer
      }
    }
  }
}

const SEGMENTS: TranscriptSegment[] = [
  { startSeconds: 1, endSeconds: 3, text: 'Before the clip starts.' },
  { startSeconds: 4, endSeconds: 6.5, text: 'Inside the clip.' },
  { startSeconds: 6.5, endSeconds: 9, text: 'Also inside.' },
  { startSeconds: 30, endSeconds: 32, text: 'Long after it ends.' }
]

const asset = (id: string, extra: Partial<Asset>): Asset => ({
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

const item = (id: string, assetId: string, extra: Partial<Item>): Item => ({
  id,
  assetId,
  trackId: 'v1',
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

/** In at 3.5s of its file, at double speed, placed at frame 90 of a 30 fps timeline. */
const INTERVIEW = item('clip_interview', 'interview', {
  from: 90,
  durationInFrames: 75,
  sourceStartUs: 3_500_000,
  speed: 2
})

function seed(): void {
  const base = emptyProject()
  const project: Project = {
    ...base,
    assets: [
      asset('interview', {}),
      asset('broll', { hasAudio: false }),
      asset('title', { kind: 'text', path: null, text: 'Chapter one', hasAudio: false, hasVideo: false })
    ],
    timelines: base.timelines.map((timeline) => ({
      ...timeline,
      fps: 30,
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'V1',
          locked: false,
          muted: false,
          hidden: false,
          items: [
            INTERVIEW,
            item('clip_broll', 'broll', { from: 200 }),
            item('clip_title', 'title', { from: 300 })
          ]
        }
      ]
    }))
  }
  useEditor.getState().enterProject(project)
  answer = { ok: true, segments: SEGMENTS, model: 'ggml-base.en.bin', language: 'en' }
}

const run = (args: Record<string, unknown>) => executeToolCall({ id: 't', tool: 'transcribe', args })

async function refusal(args: Record<string, unknown>): Promise<string> {
  const result = await run(args)
  assert.equal(result.ok, false, `expected ${JSON.stringify(args)} to be refused`)
  return result.ok ? '' : result.error
}

test('a clip’s lines come back on the timeline, mapped through that clip', async () => {
  seed()
  const result = await run({ itemId: 'clip_interview' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { cues: unknown[]; lines: number; itemId: string; model: string }
  const expected = segmentsToCues(SEGMENTS, INTERVIEW, 30)
  // The instrument: the fixture must make the mapping matter, or a tool returning the file's
  // own seconds, or ignoring speed, would pass too.
  assert.ok(expected.length >= 2 && expected.length < SEGMENTS.length, 'the clip plays some lines, not all')
  assert.notDeepEqual(expected, segmentsToCues(SEGMENTS, { ...INTERVIEW, speed: 1 }, 30), 'speed must matter')
  assert.notDeepEqual(expected, segmentsToCues(SEGMENTS, { ...INTERVIEW, sourceStartUs: 0 }, 30), 'in-point must matter')

  assert.deepEqual(value.cues, expected)
  assert.equal(value.lines, expected.length)
  assert.equal(value.itemId, 'clip_interview')
  assert.equal(value.model, 'ggml-base.en.bin')
  assert.equal(sent.at(-1)?.path, '/footage/interview.mp4', 'the clip’s own file was transcribed')
})

test('an asset without a clip comes back in the file’s seconds, with SRT', async () => {
  seed()
  const result = await run({ assetId: 'interview', language: 'de' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { segments: unknown; srt: string }
  assert.deepEqual(value.segments, SEGMENTS)
  assert.match(value.srt, /Inside the clip\./)
  assert.equal(sent.at(-1)?.language, 'de', 'the language is passed through')
  assert.deepEqual((result.value as { findings: unknown }).findings, [], 'a transcript with words has no findings')
})

test('a transcription that heard nothing carries a blocking finding, not just zero lines', async () => {
  seed()
  answer = { ok: true, segments: [], model: 'ggml-base.en.bin', language: 'en' }
  const result = await run({ assetId: 'interview', language: 'fr' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const findings = (result.value as { findings: { severity: string; message: string }[] }).findings
  assert.equal(findings.length, 1)
  assert.equal(findings[0]!.severity, 'blocking')
  assert.match(findings[0]!.message, /No speech/)
})

test('with neither itemId nor assetId, the refusal says which to pass and where to find them', async () => {
  seed()
  const error = await refusal({})
  assert.match(error, /itemId/)
  assert.match(error, /assetId/)
  assert.match(error, /read_project/)
})

test('a title has no speech, and the refusal says so rather than calling the transcriber', async () => {
  seed()
  const count = sent.length
  const error = await refusal({ itemId: 'clip_title' })
  assert.match(error, /no media file to transcribe/)
  assert.equal(sent.length, count, 'the transcriber was not called')
})

test('a clip whose file has no audio is refused by name', async () => {
  seed()
  const count = sent.length
  const error = await refusal({ itemId: 'clip_broll' })
  assert.match(error, /"broll\.mp4" has no audio track/)
  assert.equal(sent.length, count)
})

test('an unknown clip or asset id is refused with something to retry with', async () => {
  seed()
  // An id that matches nothing names what was given and where real ids are listed.
  assert.match(await refusal({ itemId: 'clip_nope' }), /"clip_nope".*read_project/)
  assert.match(await refusal({ assetId: 'nope' }), /"nope".*read_project/)
  // An ambiguous prefix names the candidates, so the next call can pick one.
  const ambiguous = await refusal({ itemId: 'clip_' })
  assert.match(ambiguous, /clip_intervi/)
  assert.match(ambiguous, /clip_broll/)
  // Positive control: an unambiguous prefix resolves.
  assert.equal((await run({ itemId: 'clip_inter' })).ok, true)
})

test('a transcriber failure reaches the agent in its own words', async () => {
  seed()
  answer = { ok: false, error: 'No whisper model on this Mac. Turn on "Download models when needed" in Settings.' }
  const error = await refusal({ itemId: 'clip_interview' })
  assert.equal(error, answer.error)
})

test('the user’s download and model settings are forwarded, both ways round', async () => {
  seed()
  const settings = useEditor.getState()
  for (const [download, model] of [
    [true, 'ggml-small.en.bin'],
    [false, null]
  ] as const) {
    settings.setAutoDownloadModels(download)
    settings.setWhisperModel(model)
    const result = await run({ itemId: 'clip_interview' })
    assert.ok(result.ok, result.ok ? '' : result.error)
    assert.deepEqual(sent.at(-1)?.options, { download, model })
  }
})

test('the same clip asked twice is transcribed once; a different model is a new transcription', async () => {
  const project: Project = emptyProject()
  project.assets.push(asset('cached', {}))
  project.timelines[0]!.tracks[0]!.items.push(item('clip_cached', 'cached', {}))
  useEditor.getState().enterProject(project)
  answer = { ok: true, segments: SEGMENTS, model: 'ggml-base.en.bin', language: 'en' }
  sent.length = 0
  await executeToolCall({ id: 'a', tool: 'transcribe', args: { itemId: 'clip_cached' } })
  await executeToolCall({ id: 'b', tool: 'transcribe', args: { itemId: 'clip_cached' } })
  assert.equal(sent.length, 1, 'the second call reused the first transcript')
  useEditor.getState().setWhisperModel('ggml-small.en.bin')
  await executeToolCall({ id: 'c', tool: 'transcribe', args: { itemId: 'clip_cached' } })
  assert.equal(sent.length, 2, 'another model is another transcription')
  useEditor.getState().setWhisperModel(null)
})

test('labels find a transcript by file, whatever language or model made it', async () => {
  seed()
  const path = '/footage/interview.mp4'
  // Transcribed in French, then the model changed in Settings: the strict key finds nothing.
  await run({ itemId: 'clip_interview', language: 'fr' })
  useEditor.getState().setWhisperModel('ggml-small.bin')
  try {
    assert.equal(cachedTranscript(path), undefined, 'the specimen must miss the exact-key lookup, or this test proves nothing')
    assert.deepEqual(anyTranscriptFor(path)?.segments, SEGMENTS)
    // Negative control: another file has none.
    assert.equal(anyTranscriptFor('/footage/broll.mp4'), undefined)
  } finally {
    useEditor.getState().setWhisperModel(null)
  }
})
