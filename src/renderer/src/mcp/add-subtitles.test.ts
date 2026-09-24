/**
 * `add_subtitles` and `set_canvas`, through the executor with the bridge stubbed. Run with
 * `pnpm test`.
 *
 * What only this level can see: that the words baked into the document are the *clip's* words in
 * the clip's own seconds (a document built from the file's seconds would light each word at the
 * wrong moment and look fine in the source), that it lands over the clip in one undo step, and
 * that a second design replaces the first rather than stacking.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import type { TranscriptSegment } from '@shared/transcribe'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'
import { forgetTranscripts } from './transcribe'

const written: { name: string; html: string }[] = []
let transcribed = 0

const SEGMENTS: TranscriptSegment[] = [
  {
    startSeconds: 10,
    endSeconds: 12,
    text: 'Ask not what',
    words: [
      { startSeconds: 10, endSeconds: 10.5, text: 'Ask' },
      { startSeconds: 10.5, endSeconds: 11, text: 'not' },
      { startSeconds: 11, endSeconds: 12, text: 'what' }
    ]
  },
  { startSeconds: 40, endSeconds: 41, text: 'Outside.', words: [{ startSeconds: 40, endSeconds: 41, text: 'Outside.' }] }
]

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      transcribe: async () => {
        transcribed += 1
        return { ok: true, segments: SEGMENTS, model: 'ggml-base.en.bin', language: 'en' }
      },
      importPaths: async (paths: string[]) =>
        paths.map((path) => {
          const html = written.find((w) => path.includes(w.name))?.html ?? ''
          const id = /data-composition-id="([^"]+)"/.exec(html)?.[1]
          const asset: Asset = {
            id: `ast_${path.length}_${written.length}`, kind: 'html', name: path.split('/').pop()!, path,
            durationUs: 2_000_000, width: 1080, height: 1920, fps: null, hasAudio: false, hasVideo: true,
            posterPath: null, waveformPath: null, createdAt: 0, compositionId: id!
          }
          return { asset }
        })
    },
    composition: {
      writeGenerated: async (name: string, html: string) => {
        written.push({ name, html })
        return { ok: true, path: `/generated/${name}.html` }
      }
    }
  }
}

const FPS = 30
function seed(extra: Partial<Asset> = {}): void {
  const project: Project = emptyProject()
  const talk: Asset = {
    id: 'talk', kind: 'video', name: 'talk.mp4', path: '/footage/talk.mp4', durationUs: 60_000_000,
    width: 1920, height: 1080, fps: FPS, hasAudio: true, hasVideo: true, posterPath: null,
    waveformPath: null, createdAt: 0, ...extra
  }
  const clip: Item = {
    id: 'clip', assetId: 'talk', trackId: project.timelines[0]!.tracks[0]!.id, from: 60,
    durationInFrames: 90, sourceStartUs: 9_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
  project.assets.push(talk)
  project.timelines[0]!.tracks[0]!.items.push(clip)
  useEditor.getState().enterProject(project)
}

beforeEach(() => {
  forgetTranscripts()
  written.length = 0
  transcribed = 0
})

const call = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: tool, tool, args })
const subtitleTrack = () => useEditor.getState().project.timelines[0]!.tracks.find((t) => t.name === 'Subtitles')

test('subtitles land over the clip, in one undo step, with the clip’s words in the clip’s seconds', async () => {
  seed()
  const past = useEditor.getState().past.length
  const result = await call('add_subtitles', { itemId: 'clip' })
  assert.equal(result.ok, true, JSON.stringify(result))
  const track = subtitleTrack()
  assert.equal(track?.items.length, 1)
  assert.equal(track!.items[0]!.from, 60)
  assert.equal(track!.items[0]!.durationInFrames, 90)
  assert.equal(useEditor.getState().past.length, past + 1, 'one undo step')
  // The clip starts 9 s into the file, so "Ask" at 10 s in the file is 1 s into the clip.
  const groups = JSON.parse(/GROUPS = (\[.*?\]);/.exec(written[0]!.html)![1]!) as { w: [number, number, string][] }[]
  const baked = groups.flatMap((g) => g.w)
  assert.deepEqual(baked.map((w) => w[2]), ['Ask', 'not', 'what'], 'only the words the clip plays')
  assert.equal(baked[0]![0], 1)
  assert.match(written[0]!.html, /data-composition-id="subtitles-spotlight"/, 'spotlight is the default')
})

test('another design replaces the first over the same clip, and reuses the transcript', async () => {
  seed()
  await call('add_subtitles', { itemId: 'clip' })
  const result = await call('add_subtitles', { itemId: 'clip', style: 'punch' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(subtitleTrack()?.items.length, 1, 'swapped, not stacked')
  assert.match(written[1]!.html, /subtitles-punch/)
  assert.equal(transcribed, 1, 'the second design did not transcribe again')
})

test('an unknown style names the real ones; a clip with no audio says so; nothing is placed', async () => {
  seed()
  const unknown = await call('add_subtitles', { itemId: 'clip', style: 'comic' })
  assert.equal(unknown.ok, false)
  assert.match(unknown.ok ? '' : unknown.error, /"spotlight", "punch", "boxed", "clean" or "reveal"/)
  seed({ hasAudio: false })
  const silent = await call('add_subtitles', { itemId: 'clip' })
  assert.match(silent.ok ? '' : silent.error, /no audio track/)
  assert.equal(subtitleTrack(), undefined)
  assert.equal(written.length, 0)
})

test('set_canvas makes the frame vertical and re-fits the footage to it, as one undo step', async () => {
  seed()
  const past = useEditor.getState().past.length
  const result = await call('set_canvas', { preset: 'vertical-1080' })
  assert.equal(result.ok, true, JSON.stringify(result))
  const timeline = useEditor.getState().project.timelines[0]!
  assert.deepEqual([timeline.width, timeline.height], [1080, 1920])
  const layout = timeline.tracks[0]!.items[0]!.layout
  // A 16:9 clip in a 9:16 frame: auto keeps it whole (contain), so it spans the width.
  assert.equal(Math.round(layout.width), 1080)
  assert.ok(layout.height < 1920)
  assert.equal(useEditor.getState().past.length, past + 1)
  const cover = await call('set_canvas', { preset: 'vertical-1080', fit: 'cover' })
  assert.equal(cover.ok, true)
  assert.equal(Math.round(useEditor.getState().project.timelines[0]!.tracks[0]!.items[0]!.layout.height), 1920, 'cover fills the height')
  const refused = await call('set_canvas', { preset: 'cinema' })
  assert.match(refused.ok ? '' : refused.error, /vertical-1080/)
})
