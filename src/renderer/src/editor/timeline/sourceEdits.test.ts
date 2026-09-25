/**
 * Replace through the real store: the source clip lands in the target's place, on the target's
 * track, at the target's length — a still included — as one undo step, and a Replace that cannot
 * land there leaves the target where it was.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Track } from '@shared/project'
import { emptyProject, newId, selectTimeline, useEditor } from '@/store/editor'
import { stillDurationFrames } from '@/store/editing-prefs'
import { runSourceEdit, useSourceClip } from './sourceEdits'

// `revealItem` scrolls the new clip into view on the next frame; there is no DOM here.
globalThis.requestAnimationFrame ??= () => 0

function asset(id: string, fields: Partial<Asset>): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/footage/${id}`,
    durationUs: 20_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: false,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 1,
    ...fields
  }
}

const FOOTAGE = asset('ast_footage', {})
const STILL = asset('ast_still', { kind: 'image', name: 'still.png', durationUs: 0, fps: 0 })
const OTHER = asset('ast_other', { name: 'other.mp4' })

function clip(assetId: string, from: number, durationInFrames: number): Item {
  return {
    id: newId('itm'),
    assetId,
    trackId: '',
    from,
    durationInFrames,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

/** V1: target [0,30) · next [30,60) — the next clip starts where the target ends. */
function load(): { target: string; next: string; v1: string } {
  const project: Project = emptyProject()
  const timeline = project.timelines[0]!
  const id = newId('trk')
  const v1: Track = {
    id,
    kind: 'video',
    name: 'V1',
    locked: false,
    muted: false,
    hidden: false,
    items: [clip(OTHER.id, 0, 30), clip(OTHER.id, 30, 30)].map((i) => ({ ...i, trackId: id }))
  }
  timeline.tracks = [v1]
  project.assets = [FOOTAGE, STILL, OTHER]
  useEditor.getState().enterProject(project)
  useEditor.getState().select([v1.items[0]!.id])
  return { target: v1.items[0]!.id, next: v1.items[1]!.id, v1: id }
}

function where(id: string): { track: string; from: number; durationInFrames: number } | undefined {
  const timeline = selectTimeline(useEditor.getState())!
  for (const track of timeline.tracks) {
    const item = track.items.find((i) => i.id === id)
    if (item) return { track: track.id, from: item.from, durationInFrames: item.durationInFrames }
  }
  return undefined
}

test('Replace with a still puts it in the target’s place on the target’s track, at the target’s length', () => {
  const ids = load()
  // The specimen: the default still length must be longer than the room the target leaves, or a
  // still placed at that length would fit and this would test nothing.
  assert.ok(stillDurationFrames(30) > 30, 'the default still length must not fit in the target’s place')
  const past = useEditor.getState().past.length
  useSourceClip.getState().setSourceClip({ assetId: STILL.id })
  const placed = runSourceEdit('replace')
  assert.ok(placed, 'the still was placed')
  assert.deepEqual(where(placed), { track: ids.v1, from: 0, durationInFrames: 30 })
  assert.equal(where(ids.target), undefined, 'the target is gone')
  assert.deepEqual(where(ids.next), { track: ids.v1, from: 30, durationInFrames: 30 }, 'the next clip is untouched')
  assert.equal(selectTimeline(useEditor.getState())!.tracks.length, 1, 'no new track')
  assert.equal(useEditor.getState().past.length, past + 1, 'one undo step')
})

test('Replace with footage takes the target’s length from the In mark, on the same track', () => {
  const ids = load()
  useSourceClip.getState().setSourceClip({ assetId: FOOTAGE.id, inUs: 2_000_000 })
  const placed = runSourceEdit('replace')
  assert.ok(placed)
  assert.deepEqual(where(placed), { track: ids.v1, from: 0, durationInFrames: 30 })
  const timeline = selectTimeline(useEditor.getState())!
  assert.equal(timeline.tracks[0]!.items.find((i) => i.id === placed)!.sourceStartUs, 2_000_000)
})

test('a Replace that cannot land in the target’s place is refused whole: the target stays and no undo step', () => {
  // A picture the store files as sound (no video stream on a gif): the Edit toolbar aims it at the
  // video track, and the store places it on an audio track instead. Synthetic, but it is the one
  // way `placeAsset` can land somewhere other than the room the target leaves.
  const ids = load()
  const soundless = asset('ast_gif', { kind: 'gif', name: 'odd.gif', hasVideo: false, durationUs: 1_000_000 })
  useEditor.setState((s) => ({ project: { ...s.project, assets: [...s.project.assets, soundless] } }))
  const before = useEditor.getState()
  const past = before.past.length
  useSourceClip.getState().setSourceClip({ assetId: soundless.id })
  const placed = runSourceEdit('replace')
  assert.equal(placed, null)
  assert.match(useEditor.getState().toast?.text ?? '', /could not be placed in other\.mp4’s place on V1/, 'refused by the landing check, not earlier')
  assert.deepEqual(where(ids.target), { track: ids.v1, from: 0, durationInFrames: 30 }, 'the target is still there')
  assert.equal(useEditor.getState().project, before.project, 'the project is the one it started as')
  assert.equal(useEditor.getState().past.length, past, 'no undo step')
  assert.deepEqual(useEditor.getState().selection, [ids.target], 'the selection is put back too')
})
