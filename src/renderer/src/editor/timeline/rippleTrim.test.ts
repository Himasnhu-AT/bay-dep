/**
 * Ripple trim through the real store: the edge moves, what follows on the track moves by the same
 * frames, other tracks stay, and it is one undo step. Every case reads positions back from the
 * store after the edit, and pairs a refusal with a legal call.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Track } from '@shared/project'
import { emptyProject, newId, selectTimeline, useEditor } from '@/store/editor'
import { applyRippleTrim, planRippleTrim, rippleHeadRoom } from './rippleTrim'

const ASSET: Asset = {
  id: 'ast_rip',
  kind: 'video',
  name: 'footage.mp4',
  path: '/footage/footage.mp4',
  durationUs: 20_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: false,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 1
}

function clip(from: number, durationInFrames: number, sourceStartUs = 0): Item {
  return {
    id: newId('itm'),
    assetId: ASSET.id,
    trackId: '',
    from,
    durationInFrames,
    sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

function lane(name: string, items: Item[], locked = false): Track {
  const id = newId('trk')
  return { id, kind: 'video', name, locked, muted: false, hidden: false, items: items.map((i) => ({ ...i, trackId: id })) }
}

/** V1: a [0,60) · b [60,120) · c [150,180). V2: d [100,130) — another track, which must not move. */
function load(options: { locked?: boolean } = {}): { a: string; b: string; c: string; d: string } {
  const project: Project = emptyProject()
  const timeline = project.timelines[0]!
  // `b` starts 2 s into its footage, so its head can grow by 60 frames.
  const v1 = lane('V1', [clip(0, 60), clip(60, 60, 2_000_000), clip(150, 30)], options.locked)
  const v2 = lane('V2', [clip(100, 30)])
  timeline.tracks = [v1, v2]
  project.assets = [ASSET]
  useEditor.getState().enterProject(project)
  return { a: v1.items[0]!.id, b: v1.items[1]!.id, c: v1.items[2]!.id, d: v2.items[0]!.id }
}

function span(id: string): [number, number] {
  const timeline = selectTimeline(useEditor.getState())!
  const found = timeline.tracks.flatMap((t) => t.items).find((i) => i.id === id)!
  return [found.from, found.from + found.durationInFrames]
}

test('ripple end, shorter: the clip loses 20 frames and the next clip closes up; other tracks stay', () => {
  const ids = load()
  const past = useEditor.getState().past.length
  assert.equal(applyRippleTrim(ids.b, 'end', 100), null)
  assert.deepEqual(span(ids.b), [60, 100])
  assert.deepEqual(span(ids.c), [130, 160])
  assert.deepEqual(span(ids.a), [0, 60])
  assert.deepEqual(span(ids.d), [100, 130], 'V2 is another track and must not move')
  assert.equal(useEditor.getState().past.length, past + 1, 'one undo step')
  useEditor.getState().undo()
  assert.deepEqual(span(ids.b), [60, 120])
  assert.deepEqual(span(ids.c), [150, 180])
})

test('ripple end, longer: later clips make room first, so the clip grows into its neighbour’s place', () => {
  const ids = load()
  assert.equal(applyRippleTrim(ids.a, 'end', 80), null)
  assert.deepEqual(span(ids.a), [0, 80])
  assert.deepEqual(span(ids.b), [80, 140])
  assert.deepEqual(span(ids.c), [170, 200])
})

test('ripple head, shorter: the clip keeps its start and everything after it moves earlier', () => {
  const ids = load()
  assert.equal(applyRippleTrim(ids.b, 'start', 70), null)
  assert.deepEqual(span(ids.b), [60, 110])
  assert.deepEqual(span(ids.c), [140, 170])
  const timeline = selectTimeline(useEditor.getState())!
  const b = timeline.tracks[0]!.items.find((i) => i.id === ids.b)!
  assert.equal(Math.round(b.sourceStartUs), Math.round(2_000_000 + (10 / 30) * 1_000_000), 'ten frames came off the head of the footage')
})

test('ripple head, longer: the clip grows at its head without moving its start', () => {
  const ids = load()
  assert.equal(applyRippleTrim(ids.b, 'start', 40), null)
  assert.deepEqual(span(ids.b), [60, 140])
  assert.deepEqual(span(ids.c), [170, 200])
})

test('a locked track is refused with the track named; the same trim on an unlocked track works', () => {
  const locked = load({ locked: true })
  const error = applyRippleTrim(locked.b, 'end', 100)
  assert.match(error ?? '', /V1 is locked/)
  assert.deepEqual(span(locked.b), [60, 120])
  const open = load()
  assert.equal(applyRippleTrim(open.b, 'end', 100), null)
  assert.deepEqual(span(open.b), [60, 100])
})

test('the plan never leaves a clip with no frames', () => {
  load()
  const timeline = selectTimeline(useEditor.getState())!
  const b = timeline.tracks[0]!.items[1]!
  assert.equal(planRippleTrim(timeline, b.id, 'end', b.from, false).ok, false)
  assert.equal(planRippleTrim(timeline, b.id, 'start', b.from + b.durationInFrames, false).ok, false)
  assert.equal(planRippleTrim(timeline, b.id, 'end', b.from + 1, false).ok, true)
})

test('head room is the footage before the in-point, not limited by frame 0', () => {
  assert.equal(rippleHeadRoom({ sourceStartUs: 2_000_000, speed: 1 }, 30, true), 60)
  assert.equal(rippleHeadRoom({ sourceStartUs: 2_000_000, speed: 2 }, 30, true), 30)
  assert.equal(rippleHeadRoom({ sourceStartUs: 0, speed: 1 }, 30, false), Number.POSITIVE_INFINITY)
})

test('a refused head grow leaves no undo step and no unsaved mark; a legal one leaves exactly one', () => {
  // `a` starts at the head of its footage, so it has no frames to grow into: the plan moves `a`,
  // `b` and `c` ten frames later to make room, and then the store refuses the trim.
  const ids = load()
  const before = useEditor.getState()
  assert.equal(before.dirty, false, 'the specimen starts saved, or "stays saved" proves nothing')
  const past = before.past.length
  const project = before.project
  assert.ok(planRippleTrim(selectTimeline(before)!, ids.a, 'start', -10, false).ok, 'the plan must move clips first, or this tests nothing')
  const error = applyRippleTrim(ids.a, 'start', -10)
  assert.match(error ?? '', /refused/)
  const after = useEditor.getState()
  assert.equal(after.past.length, past, 'no undo step for a trim that did not happen')
  assert.equal(after.dirty, false, 'a refused trim does not mark the project unsaved')
  assert.equal(after.project, project, 'the project is the one it started as, not an equal copy')
  assert.deepEqual(span(ids.a), [0, 60])
  assert.deepEqual(span(ids.b), [60, 120])
  assert.deepEqual(span(ids.c), [150, 180])

  // The positive control: `b` has two seconds of footage before its in-point, so it may grow.
  assert.equal(applyRippleTrim(ids.b, 'start', 50), null)
  assert.deepEqual(span(ids.b), [60, 130])
  assert.equal(useEditor.getState().past.length, past + 1, 'a legal grow is one undo step')
  assert.equal(useEditor.getState().dirty, true)
})
