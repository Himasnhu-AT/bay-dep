/**
 * Tests for `dryRun` — the store half of `validateOnly`.
 *
 * The promise under test is the one a dry run makes to an agent: *nothing changed*. Not "the
 * project looks the same" — no undo step, no redo stack cleared, nothing marked unsaved, no
 * `updatedAt` bumped, the selection where it was. Each test pairs the dry run with the same
 * work done for real, because a dry run of work that never changed anything would pass every
 * "nothing changed" assertion without restoring a thing.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor, emptyProject, newId } from './editor'
import { dryRun, AsyncDryRunError } from './dry-run'
import type { Item, Project } from '@shared/project'

function seeded(): { project: Project; otherTrackId: string; itemIds: string[] } {
  const project = emptyProject()
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const second = { ...video, id: newId('trk'), name: 'V2', items: [] as Item[] }
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
  return { project, otherTrackId: second.id, itemIds: [a.id, b.id] }
}

const s = () => useEditor.getState()

/** A two-call edit, grouped the way the MCP tools group theirs — and it selects, as split and delete do. */
function work(itemIds: string[], otherTrackId: string): () => { moved: string; volume: number } {
  return () => {
    s().transact(() => {
      s().select([itemIds[0]!])
      s().moveItem(itemIds[0]!, 200, otherTrackId)
      s().patchItem(itemIds[0]!, { volume: 0.25 })
    })
    const item = s()
      .project.timelines[0]!.tracks.flatMap((t) => t.items)
      .find((i) => i.id === itemIds[0])!
    return { moved: item.trackId, volume: item.volume }
  }
}

/**
 * Two starting states, because "nothing changed" measured only from a clean, empty-history
 * store would not see a restore that forgot `future` or `dirty` — both are already at the value
 * the work would leave them at.
 */
function startClean(): ReturnType<typeof seeded> {
  const seed = seeded()
  s().setProject(seed.project)
  s().setPlayhead(15)
  return seed
}

function startDirtyWithRedo(): ReturnType<typeof seeded> {
  const seed = startClean()
  s().renameProject('first')
  s().renameProject('second')
  s().undo()
  assert.equal(s().future.length, 1, 'the specimen must have a redo step to lose')
  assert.equal(s().dirty, true)
  return seed
}

for (const [label, start] of [
  ['a clean store', startClean],
  ['a dirty store with a redo step', startDirtyWithRedo]
] as const) {
  test(`from ${label}: a dry run returns the real answer and leaves every field as it was`, () => {
    const { itemIds, otherTrackId } = start()
    const before = s()

    const answer = dryRun(work(itemIds, otherTrackId))
    // The answer is the one the real edit produces — the work ran against the real store.
    assert.deepEqual(answer, { moved: otherTrackId, volume: 0.25 })

    const after = s()
    assert.equal(after.project, before.project, 'the project must be the same object')
    assert.equal(after.project.updatedAt, before.project.updatedAt)
    assert.equal(after.past, before.past, 'no undo step')
    assert.equal(after.past.length, before.past.length)
    assert.equal(after.future, before.future, 'the redo stack must survive')
    assert.equal(after.dirty, before.dirty)
    assert.deepEqual(after.selection, before.selection)
    assert.equal(after.playhead, before.playhead)
  })

  test(`from ${label}: the same work done for real does change all of it`, () => {
    // The positive control. Without it, a work function that silently did nothing would make
    // every assertion above pass against a dryRun that restores nothing.
    const { itemIds, otherTrackId } = start()
    const before = s()
    const answer = work(itemIds, otherTrackId)()
    assert.deepEqual(answer, { moved: otherTrackId, volume: 0.25 })
    const after = s()
    assert.notEqual(after.project, before.project)
    assert.equal(after.past.length, before.past.length + 1)
    assert.equal(after.future.length, 0)
    assert.equal(after.dirty, true)
    assert.deepEqual(after.selection, [itemIds[0]])
  })
}

test('a dry run that throws restores the store and rethrows the same error', () => {
  const { itemIds, otherTrackId } = startDirtyWithRedo()
  const before = s()
  const refusal = new Error('refused halfway')
  assert.throws(
    () =>
      dryRun(() => {
        work(itemIds, otherTrackId)()
        throw refusal
      }),
    (error) => error === refusal
  )
  assert.equal(s().project, before.project)
  assert.equal(s().past, before.past)
  assert.equal(s().future, before.future)
  assert.deepEqual(s().selection, before.selection)
})

test('asynchronous work is refused as a fault, and the store is still restored', () => {
  const { itemIds, otherTrackId } = startClean()
  const before = s()
  assert.throws(
    () =>
      dryRun(async () => {
        work(itemIds, otherTrackId)()
      }),
    (error) => error instanceof AsyncDryRunError && /fault in bay/.test(error.message)
  )
  assert.equal(s().project, before.project)
  assert.equal(s().past.length, before.past.length)
})

test('after a dry run, undo still takes back the edit before it', () => {
  // The observable an agent actually relies on: a dry run between two real edits must not sit
  // on the undo stack, so one undo reverses the real edit and not a phantom.
  startClean()
  s().renameProject('real edit')
  dryRun(() => s().renameProject('dry edit'))
  assert.equal(s().project.name, 'real edit')
  s().undo()
  assert.notEqual(s().project.name, 'real edit', 'one undo must reverse the real edit')
})
