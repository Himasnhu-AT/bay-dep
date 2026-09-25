/**
 * The source monitor's Insert and Overwrite, through the store.
 *
 * The defect these hold still: "Insert" used to be `placeAssetRange` — a clip dropped on whatever
 * track had room, with nothing downstream moving. The first case keeps that path beside the real
 * one so the difference is visible.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeTimeline, containLayout, coverLayout, type Asset, type Item, type Project, type Timeline } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { useEditingPrefs } from '@/store/editing-prefs'
import { placeAsset } from '@/mcp/write'
import { addTitle, editIntoTimeline, placeAssetRange } from './mediaActions'

function shot(id: string, seconds = 60): Asset {
  return {
    id, kind: 'video', name: `${id}.mp4`, path: `/m/${id}.mp4`, durationUs: seconds * 1_000_000,
    width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null,
    waveformPath: null, createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, duration: number): Item {
  return {
    id, assetId: id, trackId, from, durationInFrames: duration, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

/** V1: A 0–60, B 60–120. A1: M 0–120. Playhead 30. `N` (1 s) is in the pool, unplaced. */
function load(): void {
  const project: Project = emptyProject()
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const audio = timeline.tracks.find((t) => t.kind === 'audio')!
  for (const id of ['A', 'B', 'M']) project.assets.push(shot(id))
  project.assets.push(shot('N', 1))
  video.items.push(clip('A', video.id, 0, 60), clip('B', video.id, 60, 60))
  audio.items.push(clip('M', audio.id, 0, 120))
  useEditor.getState().setProject(project, { resetHistory: true })
  useEditor.setState({ selection: [], playhead: 30, toast: null, screen: 'editor' })
}

const s = () => useEditor.getState()
const tl = (): Timeline => activeTimeline(s().project)!
const asset = (id: string): Asset => s().project.assets.find((a) => a.id === id)!
const byAsset = (id: string): Item[] => tl().tracks.flatMap((t) => t.items).filter((i) => i.assetId === id)
const shape = (): string[] =>
  tl().tracks.flatMap((t) => [...t.items].sort((a, b) => a.from - b.from).map((i) => `${t.kind}:${i.assetId}@${i.from}+${i.durationInFrames}`))

test('Insert slides everything after the playhead right by the clip, on every track, as one undo step', () => {
  load()
  placeAssetRange(asset('N'))
  assert.equal(byAsset('B')[0]!.from, 60, 'specimen: a plain place moves nothing downstream')

  load()
  const before = shape()
  const pastBefore = s().past.length
  const placed = editIntoTimeline(asset('N'), 'insert')
  assert.ok(placed)
  const video = tl().tracks.find((t) => t.kind === 'video')!
  const inserted = video.items.find((i) => i.id === placed)
  assert.ok(inserted, 'the clip goes on V1, the track it was inserted into')
  assert.equal(inserted.from, 30)
  assert.equal(inserted.durationInFrames, 30)
  assert.equal(byAsset('B')[0]!.from, 90, 'B moved right by the inserted length')
  // A was split at the playhead; its later piece slid with everything else.
  assert.deepEqual(byAsset('A').map((i) => [i.from, i.durationInFrames]), [[0, 30], [60, 30]])
  // And the sound track opened the same span, so it stays with the picture.
  assert.deepEqual(byAsset('M').map((i) => [i.from, i.durationInFrames]), [[0, 30], [60, 90]])
  assert.equal(s().past.length, pastBefore + 1, 'one undo step')
  s().undo()
  assert.deepEqual(shape(), before)
})

test('Overwrite lands over what was there and moves nothing; a video’s sound overwrites the same span of A1', () => {
  load()
  const placed = editIntoTimeline(asset('N'), 'overwrite', { inUs: 0, outUs: 1_000_000 })
  assert.ok(placed)
  assert.equal(byAsset('B')[0]!.from, 60, 'B did not move')
  assert.deepEqual(byAsset('A').map((i) => [i.from, i.durationInFrames]), [[0, 30]], 'A lost the overwritten half')
  const video = tl().tracks.find((t) => t.kind === 'video')!
  assert.deepEqual(video.items.map((i) => [i.from, i.durationInFrames]), [[0, 30], [30, 30], [60, 60]])
  // N has sound, so it arrives as a linked pair (Preferences › Editing): its sound takes the same
  // span of A1, which M gives up there — nothing moves, and no new track appears.
  const audio = tl().tracks.filter((t) => t.kind === 'audio')
  assert.equal(audio.length, 1, 'no new audio track')
  assert.deepEqual(shape().filter((line) => line.startsWith('audio:')), ['audio:M@0+30', 'audio:N@30+30', 'audio:M@60+60'])
  const picture = video.items.find((i) => i.id === placed)!
  const sound = audio[0]!.items.find((i) => i.assetId === 'N')!
  assert.ok(picture.linkId && picture.linkId === sound.linkId, 'picture and sound are linked')
  assert.equal(picture.audioDetached, true, 'the picture plays none of its own sound')
})

test('a locked track is never overwritten: the clip goes to a lane of its own, and openSpan names the lock', () => {
  load()
  const video = tl().tracks.find((t) => t.kind === 'video')!
  s().patchTrack(video.id, { locked: true })
  const before = shape()
  editIntoTimeline(asset('N'), 'overwrite')
  // With V1 locked the lowest unlocked video track is none, so the clip gets a lane of its own
  // and nothing on V1 changes.
  assert.deepEqual(shape().filter((line) => !/^(video|audio):N@/.test(line)), before, 'V1 and A1 are untouched')
  const refused = s().openSpan(30, 30, 'overwrite', video.id)
  assert.equal(refused, null)
  assert.match(s().toast?.text ?? '', /V1 is locked/)
})

test('Add Title is one undo step: one ⌘Z takes back the clip and its asset together', () => {
  load()
  const assets = s().project.assets.length
  const past = s().past.length
  const id = addTitle('Hello', true)
  assert.equal(s().project.assets.length, assets + 1)
  assert.equal(byAsset(id).length, 1, 'placed')
  assert.equal(s().past.length, past + 1)
  s().undo()
  assert.equal(s().project.assets.length, assets)
  assert.equal(byAsset(id).length, 0)
})

test('Preferences › Editing › New clips frames a differently shaped clip, for the UI and place_asset alike', () => {
  const portrait: Asset = { ...shot('P', 5), width: 1080, height: 1920 }
  const layoutOf = (id: string | null) => tl().tracks.flatMap((t) => t.items).find((i) => i.id === id)!.layout
  const setFit = (fit: 'auto' | 'cover' | 'contain') => useEditingPrefs.setState({ newClipFit: fit })
  try {
    for (const [fit, expected] of [
      ['auto', containLayout], // a 9:16 shot on 16:9 would keep under a third under cover
      ['contain', containLayout],
      ['cover', coverLayout]
    ] as const) {
      setFit(fit)
      load()
      s().addAssets([portrait])
      const want = expected(tl(), 1080, 1920)
      assert.deepEqual(layoutOf(placeAssetRange(asset('P'))), want, `UI, ${fit}`)
      const byTool = placeAsset({ assetId: 'P', atFrame: 500 }) as { itemId: string }
      assert.deepEqual(layoutOf(byTool.itemId), want, `place_asset, ${fit}`)
    }
    assert.notDeepEqual(coverLayout(tl(), 1080, 1920), containLayout(tl(), 1080, 1920), 'specimen: the two framings differ')
  } finally {
    setFit('auto')
  }
})
