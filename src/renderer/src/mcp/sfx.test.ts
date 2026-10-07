/**
 * `score_sfx` through the executor, with the bridge stubbed. Run with `pnpm test`.
 *
 * What only this level can see: that a dry run reaches nothing — no bridge call, no asset, no
 * undo step; that creating and placing is one undo step which takes both back; that the same
 * score twice is one asset; that a refusal happens before anything is rendered; and that the
 * tool is held by "Ask before editing" like any other write while its dry run is not.
 *
 * The bridge here stands in for main (`main/sfx/write.test.ts` runs the real one against
 * ffmpeg): it records what it was asked and answers with a path named by the score, the way
 * main's content-addressed file is.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { SfxWriteResult } from '@shared/ipc'
import type { Asset } from '@shared/project'
import { useEditor, emptyProject } from '@/store/editor'
import { executeToolCall } from './index'

const rendered: { name: string; score: Record<string, unknown> }[] = []
const imported: string[] = []
let nextWrite: ((score: Record<string, unknown>) => SfxWriteResult) | null = null

const answer = (score: Record<string, unknown>): SfxWriteResult => ({
  ok: true,
  path: `/generated/sfx-${JSON.stringify(score).length}-${String(score['seed'] ?? 1)}.wav`,
  seconds: Number(score['durationSeconds']),
  events: (score['events'] as unknown[]).length,
  peakDb: -9.4,
  limitedDb: 0,
  integratedLufs: -27.3,
  truePeakDb: -9.1,
  warnings: []
})

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      scoreSfx: async (name: string, score: Record<string, unknown>) => {
        rendered.push({ name, score })
        return (nextWrite ?? answer)(score)
      },
      importPaths: async (paths: string[]) =>
        paths.map((path) => {
          imported.push(path)
          const seconds = Number(rendered[rendered.length - 1]?.score['durationSeconds'] ?? 1)
          const asset: Asset = {
            // Main dedupes by path: the same file is the same asset.
            id: `ast_${path.replace(/\W/g, '')}`, kind: 'audio', name: path.split('/').pop()!, path,
            durationUs: seconds * 1_000_000, width: 0, height: 0, fps: null, hasAudio: true, hasVideo: false,
            posterPath: null, waveformPath: null, createdAt: 0
          }
          return { asset }
        })
    }
  }
}

const SCORE = {
  durationSeconds: 4,
  events: [
    { t: 0.5, material: 'whoosh', gain: 0.6, pan: -0.4 },
    { t: 1.2, material: 'thump', gain: 1, pan: 0 }
  ]
}

beforeEach(() => {
  rendered.length = 0
  imported.length = 0
  nextWrite = null
  useEditor.getState().enterProject(emptyProject())
  useEditor.setState({ agentGate: null })
})

const call = (args: Record<string, unknown>) => executeToolCall({ id: 'score_sfx', tool: 'score_sfx', args })
const state = () => useEditor.getState()
const audioItems = () => state().project.timelines[0]!.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.items)
const fps = () => state().project.timelines[0]!.fps

test('with atFrame the sound is rendered, imported and placed on an audio track — one undo step that takes both back', async () => {
  const past = state().past.length
  const assets = state().project.assets.length
  const result = await call({ ...SCORE, name: 'Launch film', atFrame: 30 })
  assert.equal(result.ok, true, JSON.stringify(result))
  const value = (result.ok ? result.value : {}) as Record<string, unknown>

  assert.deepEqual(rendered, [{ name: 'Launch film', score: SCORE }], 'main was handed the score alone, not the placement')
  assert.deepEqual(imported, [(answer(SCORE) as { path: string }).path])
  assert.equal(state().project.assets.length, assets + 1)
  const asset = state().project.assets.find((a) => a.id === value['assetId'])
  assert.equal(asset?.name, 'Launch film')
  assert.equal(asset?.kind, 'audio')

  const items = audioItems()
  assert.equal(items.length, 1)
  assert.equal(items[0]!.id, value['itemId'])
  assert.equal(items[0]!.assetId, asset!.id)
  assert.equal(items[0]!.from, 30)
  assert.equal(items[0]!.durationInFrames, SCORE.durationSeconds * fps())
  assert.equal(value['placed'], true)
  assert.deepEqual(
    [value['events'], value['durationSeconds'], value['peakDb'], value['truePeakDb'], value['integratedLufs']],
    [2, 4, -9.4, -9.1, -27.3],
    'the result reports what was rendered and what it measured'
  )

  assert.equal(state().past.length, past + 1, 'one undo step')
  state().undo()
  assert.equal(audioItems().length, 0)
  assert.equal(useEditor.getState().project.assets.length, assets, 'undo takes the asset back with the clip')
})

test('without atFrame the asset is created and nothing is placed', async () => {
  const result = await call(SCORE)
  assert.equal(result.ok, true, JSON.stringify(result))
  const value = (result.ok ? result.value : {}) as Record<string, unknown>
  assert.equal(value['placed'], false)
  assert.equal(value['name'], 'Sound effects')
  assert.equal(rendered[0]!.name, 'Sound effects')
  assert.equal(state().project.assets.filter((a) => a.id === value['assetId']).length, 1)
  assert.equal(audioItems().length, 0)
  assert.match(String(value['next']), /place_asset/)
})

test('validateOnly checks the score and reaches nothing: no render, no import, no asset, no undo step', async () => {
  const past = state().past.length
  const assets = state().project.assets.length
  const result = await call({ ...SCORE, atFrame: 30, validateOnly: true })
  assert.equal(result.ok, true, JSON.stringify(result))
  const value = (result.ok ? result.value : {}) as Record<string, unknown>
  assert.equal(value['valid'], true)
  assert.equal(value['events'], 2)
  assert.equal(value['eventsPerSecond'], 0.5)
  assert.match(String(value['note']), /Nothing was written or changed/)
  // The peak is the render's own, made in memory: one centred thump at gain 1 sits at the knee.
  assert.ok(Math.abs(Number(value['peakDb']) - (-8 + 20 * Math.log10(0.75))) < 0.3, `peak ${String(value['peakDb'])}`)
  assert.equal(value['integratedLufs'], undefined, 'no file, so no loudness is claimed')
  assert.equal(rendered.length, 0)
  assert.equal(imported.length, 0)
  assert.equal(state().project.assets.length, assets)
  assert.equal(audioItems().length, 0)
  assert.equal(state().past.length, past)
  // The control: the same call without the flag does all of it.
  assert.equal((await call({ ...SCORE, atFrame: 30 })).ok, true)
  assert.equal(rendered.length, 1)
  assert.equal(audioItems().length, 1)
})

test('a dry run still refuses a bad score, and says what it would have cut off', async () => {
  const bad = await call({ durationSeconds: 4, events: [{ t: 1, material: 'beep' }], validateOnly: true })
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.error, /The score was not rendered\. events\[0\]\.material is "beep".*whoosh, knock, bell, thump, drop/)
  const late = await call({ durationSeconds: 4, events: [{ t: 3.5, material: 'bell' }], validateOnly: true })
  const value = (late.ok ? late.value : {}) as { warnings?: string[] }
  assert.ok(value.warnings?.some((w) => /still ringing at durationSeconds .* faded out/.test(w)), JSON.stringify(late))
  const piled = await call({
    durationSeconds: 4,
    events: ['whoosh', 'knock', 'bell', 'thump', 'drop'].map((material) => ({ t: 1, material, gain: 1 })),
    validateOnly: true
  })
  const said = (piled.ok ? piled.value : {}) as { warnings?: string[]; peakDb?: number }
  assert.ok(said.warnings?.some((w) => /limiter turned the loudest moment down/.test(w)), JSON.stringify(piled))
  assert.ok(said.peakDb !== undefined && said.peakDb <= -8)
  assert.equal(rendered.length, 0)
})

test('the same score scored twice is one asset, placed twice', async () => {
  const first = await call({ ...SCORE, atFrame: 0 })
  const second = await call({ ...SCORE, atFrame: 300 })
  assert.ok(first.ok && second.ok, JSON.stringify([first, second]))
  const a = (first.ok ? first.value : {}) as Record<string, unknown>
  const b = (second.ok ? second.value : {}) as Record<string, unknown>
  assert.equal(a['assetId'], b['assetId'])
  assert.equal(state().project.assets.filter((asset) => asset.id === a['assetId']).length, 1, 'not minted twice')
  assert.deepEqual(audioItems().map((item) => item.from).sort((x, y) => x - y), [0, 300])
  // Scored again with nowhere to place it, nothing changes: no second asset, no dead undo step.
  const past = state().past.length
  const third = await call(SCORE)
  assert.equal(((third.ok ? third.value : {}) as Record<string, unknown>)['assetId'], a['assetId'])
  assert.equal(state().project.assets.filter((asset) => asset.id === a['assetId']).length, 1)
  assert.equal(state().past.length, past, 'an asset already in the pool is not an edit')
  // A different score is a different asset.
  const other = await call({ ...SCORE, seed: 5, atFrame: 600 })
  assert.notEqual(((other.ok ? other.value : {}) as Record<string, unknown>)['assetId'], a['assetId'])
})

test('a bad score is refused before anything is rendered, in sentences that say what to change', async () => {
  const past = state().past.length
  const dense = await call({ durationSeconds: 2, events: Array.from({ length: 30 }, (_, i) => ({ t: i * 0.06, material: 'knock' })) })
  assert.equal(dense.ok, false)
  assert.match(dense.ok ? '' : dense.error, /15 events a second \(30 in 2 s\).*not one sound per visual event/)
  const late = await call({ durationSeconds: 2, events: [{ t: 2.5, material: 'knock' }] })
  assert.match(late.ok ? '' : late.error, /events\[0\]\.t is 2\.5 s, at or past the end/)
  assert.equal(rendered.length, 0)
  assert.equal(state().past.length, past)
  // The executor's own validator catches what it can before the score is read at all.
  const typed = await call({ durationSeconds: '2', events: [] })
  assert.match(typed.ok ? '' : typed.error, /"durationSeconds" must be a number/)
})

test('a video track, or a trackId with no atFrame, is refused before rendering; an audio track is used', async () => {
  const tracks = state().project.timelines[0]!.tracks
  const video = tracks.find((t) => t.kind === 'video')!
  const audio = tracks.find((t) => t.kind === 'audio')!
  const onVideo = await call({ ...SCORE, atFrame: 0, trackId: video.id })
  assert.equal(onVideo.ok, false)
  assert.match(onVideo.ok ? '' : onVideo.error, new RegExp(`go on an audio track, but ${video.name} is a video track`))
  const noFrame = await call({ ...SCORE, trackId: audio.id })
  assert.match(noFrame.ok ? '' : noFrame.error, /trackId says where to place the sound, which needs atFrame/)
  assert.equal(rendered.length, 0, 'nothing was rendered for a call that could not be placed')

  const onAudio = await call({ ...SCORE, atFrame: 0, trackId: audio.id })
  assert.equal(onAudio.ok, true, JSON.stringify(onAudio))
  assert.equal(state().project.timelines[0]!.tracks.find((t) => t.id === audio.id)!.items.length, 1)
})

test('a placement that cannot happen leaves no asset and no undo step behind', async () => {
  const audio = state().project.timelines[0]!.tracks.find((t) => t.kind === 'audio')!
  assert.equal((await call({ ...SCORE, atFrame: 0, trackId: audio.id })).ok, true)
  const past = state().past.length
  const assets = state().project.assets.length
  // A different score aimed at the frames the first one occupies on that track.
  const clash = await call({ ...SCORE, seed: 8, atFrame: 10, trackId: audio.id })
  assert.equal(clash.ok, false, JSON.stringify(clash))
  assert.equal(state().project.assets.length, assets, 'the asset of a refused placement is not left in the pool')
  assert.equal(state().past.length, past)
})

test('main’s refusal is the tool’s refusal, with its reason, and nothing is imported', async () => {
  nextWrite = () => ({ ok: false, error: 'The sound was rendered but could not be written to /generated: disk full. Nothing was added to the project.' })
  const refused = await call(SCORE)
  assert.match(refused.ok ? '' : refused.error, /could not be written to \/generated: disk full/)
  assert.equal(imported.length, 0)
  assert.equal(state().project.assets.length, 0)
})

test('warnings from the render reach the agent', async () => {
  nextWrite = (score) => ({ ...(answer(score) as Extract<SfxWriteResult, { ok: true }>), warnings: ['The limiter turned the loudest moment down by 4.2 dB.'] })
  const result = await call(SCORE)
  assert.deepEqual(((result.ok ? result.value : {}) as { warnings?: string[] }).warnings, ['The limiter turned the loudest moment down by 4.2 dB.'])
})

test('"Ask before editing" holds score_sfx like any write, and lets its dry run through', async () => {
  useEditor.setState({ agentGate: { approved: null } })
  const held = await call({ ...SCORE, atFrame: 0 })
  assert.equal(held.ok, false)
  assert.match(held.ok ? '' : held.error, /propose_edit/)
  assert.equal(rendered.length, 0, 'a held call renders nothing')
  assert.equal(audioItems().length, 0)
  const dry = await call({ ...SCORE, atFrame: 0, validateOnly: true })
  assert.equal(dry.ok, true, JSON.stringify(dry))
  // The control: with the gate off the same call runs.
  useEditor.setState({ agentGate: null })
  assert.equal((await call({ ...SCORE, atFrame: 0 })).ok, true)
})
