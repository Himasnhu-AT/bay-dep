/**
 * Track reorder, healing a through-edit and the undo history, through the real store and the
 * real tool executor: what the user's commands and the agent's tools actually do to a project.
 * The rules themselves are tested in `@shared/track-order`, `@shared/heal` and `@shared/history`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemsAtFrame, resolveTransition, type Asset, type Item, type Project, type Track } from '@shared/project'
import { historyView } from '@shared/history'
import { useEditor, emptyProject, newId, type EditorStore } from '@/store/editor'
import { stepNote } from '@/store/history-notes'
import { dropPlace, placeBeside } from '@/lib/timelineStructure'
import { executeToolCall } from './index'

const ASSET: Asset = {
  id: 'ast_footage', kind: 'video', name: 'footage.mp4', path: '/footage/footage.mp4', durationUs: 20_000_000,
  width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 1
}

function item(from: number, durationInFrames: number, sourceStartUs = 0, extra: Partial<Item> = {}): Item {
  return {
    id: newId('itm'), assetId: ASSET.id, trackId: '', from, durationInFrames, sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}
function track(kind: Track['kind'], name: string, items: Item[] = []): Track {
  const id = newId('trk')
  return { id, kind, name, locked: false, muted: false, hidden: false, items: items.map((i) => ({ ...i, trackId: id })) }
}

interface Fixture { v1: Track; v2: Track; v3: Track; a1: Track; a2: Track }

/**
 * V1: two abutting clips of different footage with a dissolve on the cut. V2: one clip, linked to
 * its detached sound on A1. V3 "Titles": one clip. A2: empty.
 */
function load(): Fixture {
  const project: Project = emptyProject()
  const timeline = project.timelines[0]!
  const v1 = track('video', 'V1', [item(0, 60), item(60, 60, 5_000_000)])
  const v2 = track('video', 'V2', [item(0, 120, 0, { linkId: 'lnk_pair', audioDetached: true })])
  const v3 = track('video', 'Titles', [item(30, 30)])
  const a1 = track('audio', 'A1', [item(0, 120, 0, { linkId: 'lnk_pair' })])
  const a2 = track('audio', 'A2')
  timeline.tracks = [v1, v2, v3, a1, a2]
  timeline.transitions = [{ id: 'trn_cut', kind: 'cross-dissolve', fromItemId: v1.items[0]!.id, toItemId: v1.items[1]!.id, durationInFrames: 12 }]
  project.assets = [ASSET]
  useEditor.getState().enterProject(project)
  return { v1, v2, v3, a1, a2 }
}

const state = (): EditorStore => useEditor.getState()
const timeline = () => state().project.timelines[0]!
const stack = (kind: Track['kind']): string[] => timeline().tracks.filter((t) => t.kind === kind).map((t) => t.name)
const call = (tool: string, args: Record<string, unknown>, origin?: 'socket') =>
  executeToolCall({ id: newId('call'), tool, args, ...(origin ? { origin } : {}) })
const history = () => historyView(state().past, state().project, state().future, stepNote)

// -- track reorder -----------------------------------------------------------------------

test('moving a track takes its clips with it, changes what draws on top, and is one undo step', () => {
  const f = load()
  const before = structuredClone(timeline())
  const topBefore = itemsAtFrame(timeline(), 40, 'video').at(-1)!
  assert.equal(topBefore.trackId, f.v3.id, 'the specimen: Titles is in front at frame 40')

  const past = state().past.length
  const moved = state().moveTrack(f.v3.id, 1)
  assert.deepEqual(moved, { trackId: f.v3.id, kind: 'video', from: 3, to: 1, renamed: [
    { trackId: f.v1.id, was: 'V1', now: 'V2' },
    { trackId: f.v2.id, was: 'V2', now: 'V3' }
  ] })
  assert.equal(state().past.length - past, 1)
  assert.deepEqual(stack('video'), ['Titles', 'V2', 'V3'])
  assert.deepEqual(stack('audio'), ['A1', 'A2'])

  // Every clip is where it was, on the track it was on, in the same order on it.
  for (const old of before.tracks) {
    assert.deepEqual(timeline().tracks.find((t) => t.id === old.id)!.items, old.items, `${old.name}'s clips`)
  }
  // What draws on top at frame 40 is now the clip on what was V2 — the picture really changed.
  assert.equal(itemsAtFrame(timeline(), 40, 'video').at(-1)!.trackId, f.v2.id)
  assert.equal(itemsAtFrame(timeline(), 40, 'video')[0]!.trackId, f.v3.id)

  state().undo()
  assert.deepEqual(timeline().tracks, before.tracks)
})

test('a transition and a link on a moved track are still the transition and the link', () => {
  const f = load()
  const dissolve = structuredClone(timeline().transitions)
  const resolvedBefore = resolveTransition(state().project, timeline(), timeline().transitions![0]!)
  assert.ok(resolvedBefore, 'the specimen: the dissolve resolves before the move')
  state().moveTrack(f.v1.id, 3)
  state().moveTrack(f.a1.id, 2)
  assert.deepEqual(timeline().transitions, dissolve)
  assert.deepEqual(resolveTransition(state().project, timeline(), timeline().transitions![0]!), resolvedBefore)
  const linked = timeline().tracks.flatMap((t) => t.items).filter((i) => i.linkId)
  assert.deepEqual(linked.map((i) => i.linkId), ['lnk_pair', 'lnk_pair'], 'the picture and its sound are still one linked pair')
})

test('a move that is refused leaves no undo step, and says why', () => {
  const f = load()
  const past = state().past.length
  const snapshot = state().project
  const refused = state().moveTrack(f.v2.id, 2)
  assert.ok('error' in refused)
  assert.match(refused.error, /“V2” is already V2/)
  assert.ok('error' in state().moveTrack(f.a2.id, 3))
  assert.equal(state().past.length, past)
  assert.equal(state().project, snapshot, 'the project object itself is untouched')
})

test('move_track: the answer lists the stacks as they now are, lowest first', async () => {
  const f = load()
  const result = await call('move_track', { trackId: f.v1.id, position: 3 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { from: string; to: string; tracks: { video: { trackId: string; number: string; name: string }[] } }
  assert.equal(value.from, 'V1')
  assert.equal(value.to, 'V3')
  assert.deepEqual(value.tracks.video.map((t) => [t.number, t.name, t.trackId]), [
    ['V1', 'V1', f.v2.id],
    ['V2', 'Titles', f.v3.id],
    ['V3', 'V3', f.v1.id]
  ])
})

test('move_track refuses a place that is not there with the range, and a dry run moves nothing', async () => {
  const f = load()
  const refused = await call('move_track', { trackId: f.a1.id, position: 5 })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /this timeline has 2 audio tracks, so position runs from 1 \(A1\) to 2\. “A1” is at 1\./)
  const unknown = await call('move_track', { trackId: 'trk_nope', position: 1 })
  assert.match(unknown.ok ? '' : unknown.error, /Tracks on this timeline: V1 \(video,/)

  const before = JSON.stringify(state().project)
  const dry = await call('move_track', { trackId: f.a1.id, position: 2, validateOnly: true })
  assert.ok(dry.ok)
  assert.equal(JSON.stringify(state().project), before)
  // The pair: the same call without the flag does move it.
  assert.ok((await call('move_track', { trackId: f.a1.id, position: 2 })).ok)
  // Both were named by their numbers, so the names still read A1, A2 — on the other tracks.
  assert.deepEqual(stack('audio'), ['A1', 'A2'])
  assert.equal(timeline().tracks.filter((t) => t.kind === 'audio')[1]!.id, f.a1.id)
})

test('one row up the screen is a higher number for video and a lower one for audio', () => {
  const f = load()
  const tracks = timeline().tracks
  assert.equal(placeBeside(tracks, f.v1.id, 'up'), 2)
  assert.equal(placeBeside(tracks, f.v1.id, 'down'), null)
  assert.equal(placeBeside(tracks, f.v3.id, 'up'), null)
  assert.equal(placeBeside(tracks, f.a1.id, 'down'), 2)
  assert.equal(placeBeside(tracks, f.a1.id, 'up'), null)
  // A drop lands on the place of the header it was dropped on — and only among its own kind.
  assert.equal(dropPlace(tracks, f.v1.id, f.v3.id), 3)
  assert.equal(dropPlace(tracks, f.v1.id, f.a1.id), null)
  assert.equal(dropPlace(tracks, f.v1.id, f.v1.id), null)
})

// -- healing a through-edit ------------------------------------------------------------------

test('a split healed is the timeline it was before the split — linked sound included', () => {
  const f = load()
  const before = structuredClone(timeline())
  state().select([f.v2.items[0]!.id])
  state().splitAt(45)
  assert.equal(timeline().tracks.find((t) => t.id === f.v2.id)!.items.length, 2)
  assert.equal(timeline().tracks.find((t) => t.id === f.a1.id)!.items.length, 2, 'the specimen: the link cut the sound too')

  const past = state().past.length
  const result = state().joinItems([f.v2.items[0]!.id])
  assert.ok('joined' in result, JSON.stringify(result))
  assert.equal(result.joined.length, 2)
  assert.equal(state().past.length - past, 1, 'picture and sound are one step')
  assert.deepEqual(timeline().tracks, before.tracks)
  // Nothing selected is an id that no longer exists.
  const live = new Set(timeline().tracks.flatMap((t) => t.items.map((i) => i.id)))
  assert.ok(state().selection.every((id) => live.has(id)))
})

test('a real cut is refused through the store with a sentence and no undo step', () => {
  const f = load()
  const past = state().past.length
  const refused = state().joinItems([f.v1.items[0]!.id, f.v1.items[1]!.id])
  assert.ok('error' in refused)
  assert.match(refused.error, /starts 3\.00s later in the source/)
  assert.equal(state().past.length, past)
  assert.ok('error' in state().joinItems([]))
})

test('join_items: the joined clip keeps the first id, and a real cut says what would make it joinable', async () => {
  const f = load()
  state().clearSelection()
  await call('split_at', { frame: 100, itemIds: [f.v1.items[1]!.id] })
  const [, left, right] = timeline().tracks.find((t) => t.id === f.v1.id)!.items
  const joined = await call('join_items', { itemIds: [left!.id, right!.id] })
  assert.ok(joined.ok, joined.ok ? '' : joined.error)
  assert.deepEqual((joined.value as { joined: unknown[] }).joined, [
    { itemId: left!.id, removedItemId: right!.id, trackId: f.v1.id, from: 60, durationInFrames: 60 }
  ])

  // The dissolve's cut: real footage on both sides, and a transition on it besides.
  const refused = await call('join_items', { itemIds: [f.v1.items[0]!.id, f.v1.items[1]!.id] })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /footage was removed at this cut, so it is not a through-edit/)

  // A lone clip with nothing after it names what is, so the next call can be written.
  const last = await call('join_items', { itemIds: [f.v3.items[0]!.id] })
  assert.match(last.ok ? '' : last.error, /No clip starts where that clip ends on Titles \(frame 60\)/)
  const unknown = await call('join_items', { itemIds: ['itm_nope'] })
  assert.equal(unknown.ok, false)
})

test('join_items with several cuts joins the through-edits and names the ones it left', async () => {
  const f = load()
  state().clearSelection()
  await call('split_at', { frame: 20 })
  const ids = timeline().tracks.find((t) => t.id === f.v1.id)!.items.map((i) => i.id)
  assert.equal(ids.length, 3)
  const result = await call('join_items', { itemIds: ids, linked: false })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { joined: unknown[]; leftAsCuts: { itemIds: string[]; why: string }[]; warning: string }
  assert.equal(value.joined.length, 1)
  assert.equal(value.leftAsCuts.length, 1)
  assert.match(value.leftAsCuts[0]!.why, /footage was removed at this cut/)
  assert.match(value.warning, /1 of the cuts named is a real cut/)
})

// -- the undo history ------------------------------------------------------------------------

test('each step says what it did and who made it: the user, the agent, an MCP client', async () => {
  const f = load()
  state().renameProject('Cut one')
  await call('move_track', { trackId: f.v1.id, position: 2 })
  await call('add_track', { kind: 'audio' }, 'socket')
  state().patchTrack(f.v2.id, { muted: true })
  const view = history()
  assert.equal(view.position, 4)
  assert.deepEqual(view.steps.map((step) => [step.actor, step.applied]), [['user', true], ['agent', true], ['client', true], ['user', true]])
  assert.equal(view.steps[0]!.label, 'Renamed the project to “Cut one”')
  assert.equal(view.steps[1]!.label, 'Move track V1 to V2')
})

test('jumping to a step undoes or redoes to it, and a later edit drops what was undone', () => {
  load()
  for (const name of ['One', 'Two', 'Three', 'Four']) state().renameProject(name)
  assert.deepEqual(state().jumpToHistory(1), { position: 1 })
  assert.equal(state().project.name, 'One')
  assert.deepEqual(history().steps.map((step) => step.applied), [true, false, false, false])
  assert.equal(state().dirty, true)

  assert.deepEqual(state().jumpToHistory(3), { position: 3 })
  assert.equal(state().project.name, 'Three')
  assert.deepEqual(state().jumpToHistory(0), { position: 0 })
  assert.equal(state().project.name, 'Untitled')
  assert.equal(state().dirty, false, 'back at the opened project nothing is unsaved')

  const refused = state().jumpToHistory(9)
  assert.ok('error' in refused)
  assert.match(refused.error, /the history runs from 0 \(before the first change\) to 4, and the project is at 0/)
  assert.equal(state().project.name, 'Untitled')

  state().jumpToHistory(2)
  state().renameProject('Another way')
  assert.deepEqual(history().steps.map((step) => step.label), [
    'Renamed the project to “One”', 'Renamed the project to “Two”', 'Renamed the project to “Another way”'
  ])
})

test('read_history and undo with a position: the agent can find a point and go back to it', async () => {
  const f = load()
  state().renameProject('By hand')
  await call('move_track', { trackId: f.v1.id, position: 3 })
  await call('add_track', { kind: 'video' })
  const read = await call('read_history', {})
  assert.ok(read.ok)
  const value = read.value as { position: number; steps: { position: number; did: string; by: string; applied: boolean }[] }
  assert.equal(value.position, 3)
  assert.deepEqual(value.steps.map((step) => [step.position, step.by, step.applied]), [[1, 'User', true], [2, 'Agent', true], [3, 'Agent', true]])
  assert.equal(value.steps[1]!.did, 'Move track V1 to V3')

  const back = await call('undo', { position: 1 })
  assert.ok(back.ok, back.ok ? '' : back.error)
  assert.deepEqual({ ...(back.value as object), timeline: 0, changed: 0 }, { position: 1, undid: 2, redid: 0, remainingUndoSteps: 1, timeline: 0, changed: 0 })
  assert.deepEqual(stack('video'), ['V1', 'V2', 'Titles'])
  assert.equal(state().project.name, 'By hand')

  const forward = await call('undo', { position: 2 })
  assert.ok(forward.ok, forward.ok ? '' : forward.error)
  const moved = forward.value as { undid: number; redid: number }
  assert.deepEqual([moved.undid, moved.redid], [0, 1])
  const refused = await call('undo', { position: 7 })
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /There is no step 7: the history runs from 0 .* to 3.*read_history/)
  // And the plain undo still is one step back.
  const one = await call('undo', {})
  assert.ok(one.ok)
  assert.equal(state().past.length, 1)
})
