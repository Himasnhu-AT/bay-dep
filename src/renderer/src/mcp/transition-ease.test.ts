import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from '@shared/project'
import { useEditor, emptyProject, newId } from '@/store/editor'
import { executeToolCall } from './index'

/**
 * `Transition.ease`, end to end through the two doors that write it: `add_transition` (the agent,
 * through the dispatcher and its schema check) and the store's `patchTransition` (the inspector's
 * ease editor). Linear must be stored as absence either way, so a project whose transitions were
 * never eased saves byte for byte as before.
 */

const ASSET: Asset = {
  id: 'ast_footage', kind: 'video', name: 'footage.mp4', path: '/footage/footage.mp4', durationUs: 20_000_000,
  width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 1
}

function item(from: number, sourceStartUs: number): Item {
  return {
    id: newId('itm'), assetId: ASSET.id, trackId: '', from, durationInFrames: 60, sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

/** Two clips abutting on V1 with room either side of the cut. */
function load(): { a: string; b: string } {
  const project: Project = emptyProject()
  const timeline = project.timelines[0]!
  const trackId = newId('trk')
  const items = [item(0, 0), item(60, 5_000_000)].map((i) => ({ ...i, trackId }))
  timeline.tracks = [{ id: trackId, kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items }]
  project.assets = [ASSET]
  useEditor.getState().enterProject(project)
  return { a: items[0]!.id, b: items[1]!.id }
}

const stored = () => useEditor.getState().project.timelines[0]!.transitions ?? []

test('add_transition stores the ease it is given, and reports it back', async () => {
  const { a, b } = load()
  const result = await executeToolCall({ id: 'c1', tool: 'add_transition', args: { fromItemId: a, toItemId: b, kind: 'push', ease: 'inOut' } })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(stored()[0]!.ease, 'inOut')
  assert.equal((result.value as { ease?: unknown }).ease, 'inOut')
})

test('add_transition takes a cubic-bezier, and linear is stored as nothing', async () => {
  const { a, b } = load()
  const curve = await executeToolCall({ id: 'c2', tool: 'add_transition', args: { fromItemId: a, toItemId: b, kind: 'wipe', ease: [0.2, 0.9, 0.6, 1] } })
  assert.ok(curve.ok, curve.ok ? '' : curve.error)
  assert.deepEqual(stored()[0]!.ease, [0.2, 0.9, 0.6, 1])
  const linear = await executeToolCall({ id: 'c3', tool: 'add_transition', args: { fromItemId: a, toItemId: b, kind: 'wipe', ease: 'linear' } })
  assert.ok(linear.ok, linear.ok ? '' : linear.error)
  assert.equal('ease' in stored()[0]!, false)
})

test('add_transition refuses a curve that runs time backwards, and says what to send', async () => {
  const { a, b } = load()
  const result = await executeToolCall({ id: 'c4', tool: 'add_transition', args: { fromItemId: a, toItemId: b, kind: 'wipe', ease: [1.5, 0, 0.5, 1] } })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /x1 and x2 must be within 0\.\.1/)
  assert.match(result.ok ? '' : result.error, /\[0\.25, 0\.1, 0\.25, 1\]/)
  // Positive control: the same call with a legal curve lands.
  const legal = await executeToolCall({ id: 'c5', tool: 'add_transition', args: { fromItemId: a, toItemId: b, kind: 'wipe', ease: [0.5, 0, 0.5, 1] } })
  assert.ok(legal.ok)
})

test('add_transition refuses a curve whose y leaves 0..1, which a keyframe would accept', async () => {
  const { a, b } = load()
  const over = await executeToolCall({ id: 'c6', tool: 'add_transition', args: { fromItemId: a, toItemId: b, kind: 'wipe', ease: [0.2, 1.3, 0.6, 1] } })
  assert.equal(over.ok, false)
  assert.match(over.ok ? '' : over.error, /y1 or y2 outside 0\.\.1/)
  assert.match(over.ok ? '' : over.error, /\[0\.42, 0, 0\.58, 1\]/)
  const under = await executeToolCall({ id: 'c7', tool: 'add_transition', args: { fromItemId: a, toItemId: b, kind: 'wipe', ease: [0.2, 0, 0.6, -0.1] } })
  assert.equal(under.ok, false)
  // Positive control: the edges themselves are legal.
  const edge = await executeToolCall({ id: 'c8', tool: 'add_transition', args: { fromItemId: a, toItemId: b, kind: 'wipe', ease: [0.2, 0, 0.6, 1] } })
  assert.ok(edge.ok, edge.ok ? '' : edge.error)
})

test('the inspector’s patch sets an ease, and putting it back to linear removes the field', () => {
  const { a, b } = load()
  const added = useEditor.getState().addTransition({ fromItemId: a, toItemId: b, kind: 'cross-dissolve', durationInFrames: 20 })
  assert.ok('id' in added)
  useEditor.getState().patchTransition(added.id, { ease: [0.1, 0.7, 0.3, 1] })
  assert.deepEqual(stored()[0]!.ease, [0.1, 0.7, 0.3, 1])
  useEditor.getState().patchTransition(added.id, { ease: 'linear' })
  assert.equal('ease' in stored()[0]!, false)
})
