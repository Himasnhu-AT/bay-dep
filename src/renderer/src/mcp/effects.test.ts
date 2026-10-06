/**
 * `edit_effects` as an agent meets it — through the real dispatcher, schema validation and all —
 * and the store actions the inspector calls: what lands in the project, what one undo takes back,
 * what is refused and what the refusal says, and what `inspect_item` reads back.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import type { Asset, Item } from '@shared/project'
import type { Effect } from '@shared/effects/spec'
import { EFFECTS, EFFECT_KINDS } from '@shared/effects/index'
import { attributePatch } from '@shared/clipboard'
import { describeChanges } from '@shared/diff'
import { emptyProject, useEditor } from '@/store/editor'
import { executeToolCall } from './index'
import { inspectItem } from './read'

function asset(id: string, kind: Asset['kind']): Asset {
  return {
    id, kind, name: `${id}.${kind}`, path: `/m/${id}`, durationUs: kind === 'video' ? 120_000_000 : 0,
    width: 1920, height: 1080, fps: 30, hasAudio: kind === 'video', hasVideo: kind !== 'audio',
    posterPath: null, waveformPath: null, createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, assetId: string): Item {
  return {
    id, assetId, trackId, from, durationInFrames: 60, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

const SHOT = 'itm_shotshotsh'
const OTHER = 'itm_otherother'
const TITLE = 'itm_titletitle'
const LOCKED = 'itm_lockedlock'

function load(): void {
  const project = emptyProject()
  project.assets = [asset('shot', 'video'), asset('title', 'text')]
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  video.items = [clip(SHOT, video.id, 0, 'shot'), clip(OTHER, video.id, 100, 'shot'), clip(TITLE, video.id, 200, 'title')]
  timeline.tracks.push({ ...video, id: 'trk_locked', name: 'V9', locked: true, items: [clip(LOCKED, 'trk_locked', 0, 'shot')] })
  // `enterProject`: a project open in the editor. With `setProject` alone every tool is refused.
  useEditor.getState().enterProject(project)
}

let calls = 0
async function call(args: Record<string, unknown>): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  const result = await executeToolCall({ id: `c${(calls += 1)}`, tool: 'edit_effects', args })
  return result.ok ? { ok: true, value: result.value as Record<string, unknown> } : { ok: false, error: result.error }
}

async function done(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await call(args)
  assert.ok(result.ok, result.ok ? '' : result.error)
  return result.value
}

async function refused(args: Record<string, unknown>): Promise<string> {
  const result = await call(args)
  assert.ok(!result.ok, `expected ${JSON.stringify(args)} to be refused`)
  return result.error
}

const state = () => useEditor.getState()
const stored = (id: string): Item => state().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === id)!
const past = (): number => state().past.length
const kinds = (id: string): string[] => (stored(id).effects ?? []).map((e) => e.kind)

test('a batch lands in order as one undo step and comes back with the ids to address', async () => {
  load()
  const before = past()
  const result = await done({
    itemId: SHOT,
    operations: [
      { op: 'add', kind: 'chroma-key', params: { color: '#00ff00', similarity: 0.3 } },
      { op: 'add', kind: 'glow', params: { amount: 0.8 } }
    ]
  })
  assert.equal(past(), before + 1)
  assert.deepEqual(kinds(SHOT), ['chroma-key', 'glow'], 'in the order given, which is the order drawn')
  assert.equal(stored(OTHER).effects, undefined, 'only the clip named')

  const effects = result.effects as { id: string; kind: string; index: number; draws: boolean; params: Record<string, unknown> }[]
  assert.deepEqual(effects.map((e) => [e.index, e.kind, e.draws]), [[0, 'chroma-key', true], [1, 'glow', true]])
  assert.deepEqual(result.added, effects.map((e) => e.id))
  assert.equal(effects[0]?.params.color, '#00FF00')
  assert.equal(effects[0]?.params.smoothness, 0.08, 'a parameter left out is stored at its default')

  // The ids it returned are the ids the next call uses.
  const glow = effects[1]?.id ?? ''
  await done({ itemId: SHOT, operations: [{ op: 'move', effectId: glow, toIndex: 0 }, { op: 'update', effectId: glow, params: { radius: 30 } }] })
  assert.deepEqual(kinds(SHOT), ['glow', 'chroma-key'])
  assert.equal(stored(SHOT).effects?.[0]?.params.radius, 30)
  assert.equal(stored(SHOT).effects?.[0]?.params.amount, 0.8, 'update merges')

  state().undo()
  assert.deepEqual(kinds(SHOT), ['chroma-key', 'glow'], 'one undo takes back the whole second call')
  state().undo()
  assert.equal(stored(SHOT).effects, undefined, 'and the next the whole first')
})

test('inspect_item reads the stack back with what will draw', async () => {
  load()
  assert.equal('effects' in inspectItem({ itemId: SHOT }), false, 'absent means the clip has none')
  await done({
    itemId: SHOT,
    operations: [
      { op: 'add', kind: 'glow' },
      { op: 'add', kind: 'tint', params: { amount: 0 } },
      { op: 'add', kind: 'flip', enabled: false }
    ]
  })
  const effects = inspectItem({ itemId: SHOT }).effects as { kind: string; draws: boolean; enabled: boolean; why?: string }[]
  assert.deepEqual(effects.map((e) => [e.kind, e.enabled, e.draws]), [['glow', true, true], ['tint', true, false], ['flip', false, false]])
  assert.match(effects[1]?.why ?? '', /changes nothing/)
  assert.match(effects[2]?.why ?? '', /switched off/)
})

test('a value out of range is refused with the range and changes nothing; the same call in range lands', async () => {
  load()
  const before = past()
  const message = await refused({ itemId: SHOT, operations: [{ op: 'add', kind: 'flip' }, { op: 'add', kind: 'sharpen', params: { amount: 9 } }] })
  assert.match(message, /operations\[1\]: sharpen\.amount must be a number from 0 to 3/)
  assert.equal(stored(SHOT).effects, undefined, 'the flip before it did not land either')
  assert.equal(past(), before, 'a refusal is not an undo step')
  await done({ itemId: SHOT, operations: [{ op: 'add', kind: 'flip' }, { op: 'add', kind: 'sharpen', params: { amount: 3 } }] })
  assert.deepEqual(kinds(SHOT), ['flip', 'sharpen'])
})

test('a clip with no picture, and a clip on a locked track, are refused saying what would work', async () => {
  load()
  const title = await refused({ itemId: TITLE, operations: [{ op: 'add', kind: 'glow' }] })
  assert.match(title, /title\.text is text/)
  assert.match(title, /video, image, gif, html, brf/)
  assert.match(title, /edit_item text/, 'it names where a title\'s look is set')
  const locked = await refused({ itemId: LOCKED, operations: [{ op: 'add', kind: 'glow' }] })
  assert.match(locked, /V9 is locked/)
  assert.equal(stored(LOCKED).effects, undefined)
  // The pair: the same operation on an unlocked picture clip.
  await done({ itemId: SHOT, operations: [{ op: 'add', kind: 'glow' }] })
  assert.deepEqual(kinds(SHOT), ['glow'])
})

test('the schema refuses a call that is not shaped like one, before the handler runs', async () => {
  load()
  assert.match(await refused({ itemId: SHOT }), /operations/)
  assert.match(await refused({ itemId: SHOT, operations: [{ op: 'add', kind: 'gaussian-blur' }] }), /gaussian-blur/)
  assert.equal(stored(SHOT).effects, undefined)
})

test('validateOnly reports the stack it would make and leaves the project and its history alone', async () => {
  load()
  const before = past()
  const snapshot = JSON.stringify(state().project)
  const result = await done({ itemId: SHOT, validateOnly: true, operations: [{ op: 'add', kind: 'pixelate', params: { size: 40 } }] })
  assert.match(JSON.stringify(result), /pixelate/)
  assert.equal(JSON.stringify(state().project), snapshot)
  assert.equal(past(), before)
})

test('removing the last effect stores absence, so the clip saves as it did before it had one', async () => {
  load()
  const untouched = JSON.stringify(stored(SHOT))
  const added = await done({ itemId: SHOT, operations: [{ op: 'add', kind: 'glow' }] })
  const id = (added.added as string[])[0]
  await done({ itemId: SHOT, operations: [{ op: 'remove', effectId: id }] })
  assert.equal('effects' in stored(SHOT), false, 'not an empty array')
  assert.equal(JSON.stringify(stored(SHOT)), untouched)
  // clear does the same from any size.
  await done({ itemId: SHOT, operations: [{ op: 'add', kind: 'glow' }, { op: 'add', kind: 'flip' }] })
  const cleared = await done({ itemId: SHOT, operations: [{ op: 'clear' }] })
  assert.equal(JSON.stringify(stored(SHOT)), untouched)
  assert.match(String(cleared.note), /no effects/)
})

test('the tool tells the agent every effect and what it must not be used for', () => {
  const tool = findTool('edit_effects')
  assert.ok(tool)
  for (const spec of EFFECTS) {
    assert.ok(tool.description.includes(`${spec.kind} — `), `${spec.kind} is not in the tool's description`)
    for (const name of Object.keys(spec.params)) assert.ok(tool.description.includes(name), `${spec.kind}.${name}`)
  }
  // The effects left out on purpose, and where each lives instead.
  assert.match(tool.description, /adjustments\.blur/)
  assert.match(tool.description, /vignette, film grain and halation are edit_item grade/)
  const items = (tool.inputSchema.properties.operations as { items: { properties: { kind: { enum: string[] } } } }).items
  assert.deepEqual(items.properties.kind.enum, [...EFFECT_KINDS])
})

// -- the store actions the inspector and the library call --------------------------------------

test('store: add, change, reorder, switch and remove, each one undo step', () => {
  load()
  const start = past()
  const glow = state().addEffect(SHOT, 'glow')
  const flip = state().addEffect(SHOT, 'flip')
  const first = state().addEffect(SHOT, 'pixelate', { index: 0, params: { size: 32 } })
  assert.ok(glow && flip && first)
  assert.equal(past(), start + 3)
  assert.deepEqual(kinds(SHOT), ['pixelate', 'glow', 'flip'])
  assert.equal(stored(SHOT).effects?.[0]?.params.size, 32)

  state().patchEffect(SHOT, glow, { params: { amount: 1.4 } })
  assert.equal(stored(SHOT).effects?.[1]?.params.amount, 1.4)
  assert.equal(stored(SHOT).effects?.[1]?.params.radius, 16, 'the rest of its parameters are kept')

  state().moveEffect(SHOT, flip, 0)
  assert.deepEqual(kinds(SHOT), ['flip', 'pixelate', 'glow'])

  state().toggleEffect(SHOT, glow)
  assert.equal(stored(SHOT).effects?.[2]?.enabled, false)
  state().toggleEffect(SHOT, glow)
  assert.equal('enabled' in (stored(SHOT).effects?.[2] as Effect), false, 'on is stored as absence')

  state().removeEffect(SHOT, first)
  assert.deepEqual(kinds(SHOT), ['flip', 'glow'])
  assert.equal(past(), start + 8)

  state().undo()
  assert.deepEqual(kinds(SHOT), ['flip', 'pixelate', 'glow'], 'undo puts the removed effect back where it was')
})

test('store: a value out of range is refused with a toast and no undo step; a locked clip is left alone', () => {
  load()
  const glow = state().addEffect(SHOT, 'glow')
  assert.ok(glow)
  const before = past()
  state().patchEffect(SHOT, glow, { params: { amount: 50 } })
  assert.equal(stored(SHOT).effects?.[0]?.params.amount, 0.6, 'nothing was stored')
  assert.equal(past(), before)
  assert.match(state().toast?.text ?? '', /glow\.amount must be a number from 0 to 2/)
  // The pair.
  state().patchEffect(SHOT, glow, { params: { amount: 2 } })
  assert.equal(stored(SHOT).effects?.[0]?.params.amount, 2)
  assert.equal(past(), before + 1)

  assert.equal(state().addEffect(LOCKED, 'glow'), null)
  assert.equal(stored(LOCKED).effects, undefined)
  assert.equal(state().addEffect(SHOT, 'no-such-effect'), null)
})

// -- what else carries a stack -------------------------------------------------------------------

test('the Changes card says what a turn did to a clip\'s effects, in draw order', async () => {
  load()
  const before = state().project
  await done({ itemId: SHOT, operations: [{ op: 'add', kind: 'chroma-key' }, { op: 'add', kind: 'glow', enabled: false }] })
  const added = describeChanges(before, state().project).map((line) => line.text)
  assert.deepEqual(added, ['Effects on “shot.video”: chroma-key, glow (off)'])
  const withEffects = state().project
  await done({ itemId: SHOT, operations: [{ op: 'clear' }] })
  assert.deepEqual(describeChanges(withEffects, state().project).map((line) => line.text), ['Removed the effects from “shot.video”'])
  // The pair: an edit that leaves the stack alone says nothing about it.
  assert.deepEqual(describeChanges(withEffects, withEffects), [])
})

test('Paste Attributes carries the stack as a copy, and "no effects" is a paste too', () => {
  load()
  state().addEffect(SHOT, 'glow')
  state().addEffect(SHOT, 'flip')
  const source = stored(SHOT)
  const patch = attributePatch(source, stored(OTHER), new Set(['effects']))
  assert.deepEqual(Object.keys(patch), ['effects'])
  assert.deepEqual(patch.effects, source.effects)
  assert.notEqual(patch.effects, source.effects, 'a copy: editing one clip\'s stack must not edit the other\'s')
  assert.notEqual(patch.effects?.[0]?.params, source.effects?.[0]?.params)
  // From a clip with none onto a clip with some: the stack is removed.
  const cleared = attributePatch(stored(OTHER), source, new Set(['effects']))
  assert.equal('effects' in cleared && cleared.effects === undefined, true)
  // Not asked for, not touched.
  assert.equal('effects' in attributePatch(source, stored(OTHER), new Set(['grade'])), false)
})
