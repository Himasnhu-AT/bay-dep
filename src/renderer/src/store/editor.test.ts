/**
 * Tests for the store's history grouping.
 *
 * The property under test is a promise the agent surface makes out loud: *one agent edit is
 * one undo step*. Every store action is its own `edit()` and every `edit()` pushes history,
 * so any tool needing two calls — moving an item to another track, a ripple delete — breaks
 * that promise unless the calls are grouped. A half-undo is worse than no undo: it leaves the
 * project in a state neither the user nor the agent asked for.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor, emptyProject, newId } from './editor'
import type { Item, Project } from '@shared/project'

/** A project with two items on one video track, so track moves and ripples have something to act on. */
function seeded(): { project: Project; trackId: string; otherTrackId: string; itemIds: string[] } {
  const project = emptyProject()
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const second = {
    ...video,
    id: newId('trk'),
    name: 'V2',
    items: [] as Item[]
  }
  timeline.tracks.push(second)

  const make = (from: number): Item => ({
    id: newId('itm'),
    assetId: 'ast_x',
    trackId: video.id,
    from,
    durationInFrames: 30,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  })
  const a = make(0)
  const b = make(60)
  video.items.push(a, b)
  return { project, trackId: video.id, otherTrackId: second.id, itemIds: [a.id, b.id] }
}

function load(): ReturnType<typeof seeded> {
  const s = seeded()
  useEditor.getState().setProject(s.project)
  return s
}

const past = (): number => useEditor.getState().past.length

test('two edits inside a transaction are one undo step', () => {
  const { itemIds, otherTrackId } = load()
  const before = past()

  useEditor.getState().transact(() => {
    useEditor.getState().patchItem(itemIds[0]!, { from: 10 })
    useEditor.getState().moveItem(itemIds[0]!, 10, otherTrackId)
  })

  assert.equal(past(), before + 1, 'a grouped edit must push exactly one history entry')
})

test('undo after a transaction reverses all of it, not the last part', () => {
  const { itemIds, otherTrackId, trackId } = load()

  useEditor.getState().transact(() => {
    useEditor.getState().patchItem(itemIds[0]!, { from: 10, durationInFrames: 45 })
    useEditor.getState().moveItem(itemIds[0]!, 10, otherTrackId)
  })
  useEditor.getState().undo()

  // Both halves must be back: the timing *and* the track. Reversing only the move would
  // leave the item on its original track with a duration nobody chose, which is the exact
  // half-undone state this grouping exists to prevent.
  const timeline = useEditor.getState().project.timelines[0]!
  const found = timeline.tracks.flatMap((t) => t.items.map((i) => ({ i, t }))).find(
    (e) => e.i.id === itemIds[0]
  )!
  assert.equal(found.i.from, 0)
  assert.equal(found.i.durationInFrames, 30)
  assert.equal(found.t.id, trackId)
})

test('a transaction that changes nothing pushes no entry', () => {
  load()
  const before = past()
  useEditor.getState().transact(() => {})
  assert.equal(past(), before, 'an undo step that restores the state you are in is a dead control')
})

test('a transaction whose edits are all refused pushes no entry', () => {
  const { itemIds } = load()
  const before = past()

  // Moving onto occupied time on the same track is refused by the store, so nothing changes.
  useEditor.getState().transact(() => {
    useEditor.getState().moveItem(itemIds[1]!, 0)
  })

  assert.equal(past(), before, 'a refused edit must not leave an empty undo step behind')
})

test('a nested transaction joins the outer one rather than closing it', () => {
  const { itemIds } = load()
  const before = past()

  useEditor.getState().transact(() => {
    useEditor.getState().patchItem(itemIds[0]!, { from: 5 })
    useEditor.getState().transact(() => {
      useEditor.getState().patchItem(itemIds[1]!, { from: 90 })
    })
    useEditor.getState().patchItem(itemIds[0]!, { opacity: 0.5 } as never)
  })

  assert.equal(past(), before + 1, 'nesting must not split one logical edit across two steps')
})

test('a transaction that throws still commits what it managed, as one step', () => {
  const { itemIds } = load()
  const before = past()

  assert.throws(() => {
    useEditor.getState().transact(() => {
      useEditor.getState().patchItem(itemIds[0]!, { from: 12 })
      throw new Error('half way')
    })
  }, /half way/)

  assert.equal(past(), before + 1, 'a partial edit is still one undoable step, not zero')
  const item = useEditor
    .getState()
    .project.timelines[0]!.tracks.flatMap((t) => t.items)
    .find((i) => i.id === itemIds[0])!
  assert.equal(item.from, 12, 'and what it managed stays until undone')

  useEditor.getState().undo()
  const back = useEditor
    .getState()
    .project.timelines[0]!.tracks.flatMap((t) => t.items)
    .find((i) => i.id === itemIds[0])!
  assert.equal(back.from, 0)
})

test('silent edits inside a transaction do not create an undo step on their own', () => {
  const { project } = load()
  const before = past()

  // Poster and waveform arrivals are silent by design — they are not edits. A tool that
  // groups work must not turn one into an undoable step just by being open at the time.
  useEditor.getState().transact(() => {
    useEditor.getState().patchAsset(project.assets[0]?.id ?? 'missing', { posterPath: '/tmp/p.jpg' })
  })

  assert.equal(past(), before, 'a silent mutation is still silent inside a transaction')
})

test('history outside a transaction is unchanged', () => {
  const { itemIds } = load()
  const before = past()
  useEditor.getState().patchItem(itemIds[0]!, { from: 15 })
  useEditor.getState().patchItem(itemIds[0]!, { from: 20 })
  assert.equal(past(), before + 2, 'ungrouped edits are still one step each')
})

// -- gestures: a drag on the preview is many live edits and one undo step -------------------

test('a gesture lands each edit live and pushes one history entry on end', () => {
  const { itemIds } = load()
  const id = itemIds[0]!
  const before = past()
  const layoutOf = (): { left: number } =>
    useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === id)!.layout

  useEditor.getState().beginGesture()
  useEditor.getState().patchLayout(id, { left: 10 })
  assert.equal(layoutOf().left, 10, 'the first move must be visible while the drag is still going')
  useEditor.getState().patchLayout(id, { left: 20 })
  useEditor.getState().patchLayout(id, { left: 30 })
  assert.equal(past(), before, 'nothing is pushed while the gesture is open')
  useEditor.getState().endGesture()

  assert.equal(past(), before + 1, 'a whole drag is exactly one undo step')
  useEditor.getState().undo()
  assert.equal(layoutOf().left, 0, 'undo takes the drag back to where it started, not one move back')
})

test('a gesture that changed nothing pushes nothing, and history records again afterwards', () => {
  const { itemIds } = load()
  const before = past()
  useEditor.getState().beginGesture()
  useEditor.getState().endGesture()
  assert.equal(past(), before, 'a click on a clip without a drag is not an edit')
  // Positive control: the gesture closed, so an ordinary edit is its own step again.
  useEditor.getState().patchLayout(itemIds[0]!, { left: 5 })
  assert.equal(past(), before + 1)
  // An unpaired end is ignored rather than driving the depth negative.
  useEditor.getState().endGesture()
  useEditor.getState().patchLayout(itemIds[0]!, { left: 6 })
  assert.equal(past(), before + 2)
})
