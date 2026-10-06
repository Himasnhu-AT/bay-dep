/**
 * `edit_item({ reverse, speedRamp })` and `inspect_item`, through the real dispatcher and the real
 * store: what the agent can do to a clip's time, what it is told, and what it is refused.
 *
 * The plan itself is tested in `@shared/retime.test.ts`. Here: that the tool reaches it, that the
 * result says what happened in the units the arguments are in, and that each refusal carries the
 * call that would work — paired with a call that does.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Track } from '@shared/project'
import { itemEnd, sourceSpanOf, sourceTimeAt } from '@shared/project'
import { useEditor, emptyProject, newId, type EditorStore } from '@/store/editor'
import { executeToolCall } from './index'
import { renderScript } from '@shared/script'

const FOOTAGE: Asset = {
  id: 'ast_footage', kind: 'video', name: 'footage.mp4', path: '/footage/footage.mp4', durationUs: 20_000_000,
  width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 1
}
const STILL: Asset = { ...FOOTAGE, id: 'ast_still', kind: 'image', name: 'still.png', path: '/footage/still.png', durationUs: 0, hasAudio: false }

function item(assetId: string, from: number, durationInFrames: number, sourceStartUs = 0): Item {
  return {
    id: newId('itm'), assetId, trackId: '', from, durationInFrames, sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

function track(kind: 'video' | 'audio', name: string, items: Item[]): Track {
  const id = newId('trk')
  for (const each of items) each.trackId = id
  return { id, kind, name, locked: false, muted: false, hidden: false, items }
}

/** V1: `a` (2 s…5 s of footage) at 0, `b` at 200. V2: a still. */
function load(): { a: string; b: string; still: string } {
  const project: Project = emptyProject()
  const v1 = track('video', 'V1', [item(FOOTAGE.id, 0, 90, 2_000_000), item(FOOTAGE.id, 200, 60, 10_000_000)])
  const v2 = track('video', 'V2', [item(STILL.id, 0, 90)])
  project.timelines[0]!.tracks = [v1, v2]
  project.timelines[0]!.fps = 30
  project.assets = [FOOTAGE, STILL]
  useEditor.getState().enterProject(project)
  return { a: v1.items[0]!.id, b: v1.items[1]!.id, still: v2.items[0]!.id }
}

const state = (): EditorStore => useEditor.getState()
const clipOf = (id: string): Item => state().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === id)!

async function call(tool: string, args: Record<string, unknown>): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  const result = await executeToolCall({ id: newId('call'), tool, args })
  return result.ok ? { ok: true, value: result.value as Record<string, unknown> } : { ok: false, error: result.error }
}

test('edit_item reverse: the same footage backwards, in place, and the result says what its sound does', async () => {
  const f = load()
  const before = structuredClone(clipOf(f.a))
  const result = await call('edit_item', { itemId: f.a, reverse: true })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const after = clipOf(f.a)
  assert.equal(after.reverse, true)
  assert.equal(after.from, before.from)
  assert.equal(after.durationInFrames, before.durationInFrames)
  assert.deepEqual(sourceSpanOf(after, 30), sourceSpanOf(before, 30))
  assert.equal(sourceTimeAt(after, itemEnd(after) - 1, 30), before.sourceStartUs)
  // The result, in the argument's units.
  assert.equal(result.value.reverse, true)
  assert.equal(result.value.sourceStartSeconds, 5)
  assert.deepEqual(result.value.footageSeconds, [2, 5])
  const sound = result.value.sound as { preview: string; export: string; note: string }
  assert.deepEqual([sound.preview, sound.export], ['silent', 'reversed'])
  assert.match(sound.note, /silent in the preview/)
  // inspect_item reports the same.
  const seen = await call('inspect_item', { itemId: f.a })
  assert.ok(seen.ok)
  const timing = seen.ok ? (seen.value.timing as Record<string, unknown>) : {}
  assert.equal(timing.reverse, true)
  assert.deepEqual(timing.footageSeconds, [2, 5])
  assert.equal(timing.sourceRemainingSeconds, 5, 'what is left of the source is what lies before a reversed clip')
  // One undo puts it back whole; false plays it forwards again.
  state().undo()
  assert.deepEqual(clipOf(f.a), before)
  await call('edit_item', { itemId: f.a, reverse: true })
  const forwards = await call('edit_item', { itemId: f.a, reverse: false })
  assert.ok(forwards.ok)
  assert.deepEqual(clipOf(f.a), before)
  assert.equal(forwards.ok && forwards.value.reverse, undefined, 'a plain clip reads back as it always did')
  assert.equal(forwards.ok && forwards.value.sound, undefined)
})

test('edit_item speedRamp: 100% → 25% → 100%, the clip’s length follows, and the result reports it', async () => {
  const f = load()
  const keys = [
    { frame: 30, speed: 1, ease: 'inOut' },
    { frame: 40, speed: 0.25 },
    { frame: 70, speed: 0.25, ease: 'inOut' },
    { frame: 80, speed: 1 }
  ]
  const result = await call('edit_item', { itemId: f.a, speedRamp: keys })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const after = clipOf(f.a)
  assert.ok(after.durationInFrames > 90, `the slow stretch makes the clip longer: ${after.durationInFrames}`)
  assert.equal(result.value.durationInFrames, after.durationInFrames)
  assert.deepEqual((result.value.retimed as Record<string, unknown>).fromDurationInFrames, 90)
  assert.deepEqual(result.value.speedRamp, keys, 'read back in the unit it was written in')
  assert.equal(result.value.speedRange, '25–100%')
  // It still reads 2 s…5 s, to within a frame.
  const span = sourceSpanOf(after, 30)
  assert.equal(span.startUs, 2_000_000)
  assert.ok(Math.abs(span.endUs - 5_000_000) <= 33_334, `ends at ${span.endUs}`)
  assert.deepEqual((result.value.sound as { preview: string; export: string }).preview, 'silent')
  assert.deepEqual((result.value.sound as { preview: string; export: string }).export, 'silent')
  // The sound finish must not claim the clip is audible either.
  // speedRamp: null goes back to the constant speed and the length it had.
  const back = await call('edit_item', { itemId: f.a, speedRamp: null })
  assert.ok(back.ok)
  assert.equal(clipOf(f.a).keyframes, undefined)
  assert.equal(clipOf(f.a).durationInFrames, 90)
})

test('a ramp that would grow into the next clip stops there and warns; ripple: true moves the next clip instead', async () => {
  const f = load()
  // 90 frames of footage at a quarter speed wants 360 frames; `b` starts at 200.
  const clamped = await call('edit_item', { itemId: f.a, speedRamp: [{ frame: 0, speed: 0.25 }] })
  assert.ok(clamped.ok, clamped.ok ? '' : clamped.error)
  assert.equal(clipOf(f.a).durationInFrames, 200)
  const warnings = (clamped.ok ? clamped.value.warnings : []) as string[]
  assert.ok(warnings.some((w) => w.includes(f.b) && /ripple: true/.test(w) && /360 frames/.test(w)), JSON.stringify(warnings))

  const g = load()
  const rippled = await call('edit_item', { itemId: g.a, speedRamp: [{ frame: 0, speed: 0.25 }], ripple: true })
  assert.ok(rippled.ok)
  assert.equal(clipOf(g.a).durationInFrames, 360)
  assert.equal(clipOf(g.b).from, 470)
})

test('a hold is a ramp to 0: the frame freezes and the clip is that much longer', async () => {
  const f = load()
  const result = await call('edit_item', { itemId: f.a, speedRamp: 'hold' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const after = clipOf(f.a)
  assert.equal(after.durationInFrames, 120, '90 frames of footage and one second held')
  const held = sourceTimeAt(after, 45, 30)
  for (let frame = 45; frame <= 75; frame += 1) assert.equal(sourceTimeAt(after, frame, 30), held, `frame ${frame}`)
  assert.notEqual(sourceTimeAt(after, 44, 30), held)
  assert.notEqual(sourceTimeAt(after, 76, 30), held)
  // The last frame is still the footage's last.
  assert.equal(sourceTimeAt(after, 119, 30), 2_000_000 + 2_966_667)
})

test('refusals name the call that works, and the nearest legal call succeeds', async () => {
  const f = load()
  const refused = async (args: Record<string, unknown>, pattern: RegExp): Promise<void> => {
    const before = JSON.stringify(state().project.timelines)
    const result = await call('edit_item', args)
    assert.equal(result.ok, false, JSON.stringify(args))
    assert.match(result.ok ? '' : result.error, pattern, JSON.stringify(args))
    assert.equal(JSON.stringify(state().project.timelines), before, 'a refused call changes nothing')
  }
  // A still has nothing to reverse or ramp; footage does.
  await refused({ itemId: f.still, reverse: true }, /still\.png.*no footage to retime.*video and audio clips/)
  await refused({ itemId: f.still, speedRamp: 'ramp-down' }, /no footage to retime/)
  // With a move in the same call: told to make two calls, with the first one spelled.
  await refused({ itemId: f.a, reverse: true, from: 10 }, new RegExp(`cannot share a call with from.*edit_item\\(\\{ itemId: "${f.a}", from`))
  await refused({ itemId: f.a, speedRamp: 'montage', durationInFrames: 50 }, /cannot share a call with durationInFrames/)
  // speed and a ramp together.
  await refused({ itemId: f.a, speedRamp: 'montage', speed: 2 }, /Drop speed, or drop speedRamp/)
  // A bad ramp is named by key.
  await refused({ itemId: f.a, speedRamp: [{ frame: 0, speed: 1 }, { frame: 20, speed: 0 }] }, /ends at speed 0 \(frame 20\)/)
  await refused({ itemId: f.a, speedRamp: [{ frame: 0, speed: 50 }] }, /speedRamp\[0\]\.speed/)
  await refused({ itemId: f.a, reverse: 'yes' }, /"reverse" must be true or false/)
  // Speed keys through `keyframes` are sent to speedRamp.
  await refused({ itemId: f.a, keyframes: { speed: [{ frame: 0, value: 0.5 }] } }, /speedRamp/)

  // The twins: each of those, made legal.
  assert.ok((await call('edit_item', { itemId: f.a, reverse: true, speed: 2 })).ok, 'reverse with a constant speed is one plan')
  assert.equal(clipOf(f.a).durationInFrames, 45)
  assert.equal(clipOf(f.a).reverse, true)
  assert.ok((await call('edit_item', { itemId: f.a, from: 10 })).ok, 'and the move is its own call')
  assert.equal(clipOf(f.a).from, 10)
  assert.ok((await call('edit_item', { itemId: f.a, speedRamp: [{ frame: 0, speed: 1, ease: 'hold' }, { frame: 20, speed: 0, ease: 'hold' }, { frame: 44, speed: 1 }] })).ok)
})

test('a reversed clip trims and splits through the tools, and still plays its footage backwards', async () => {
  const f = load()
  await call('edit_item', { itemId: f.a, reverse: true })
  const before = new Map<number, number>()
  for (let frame = 0; frame < 90; frame += 1) before.set(frame, sourceTimeAt(clipOf(f.a), frame, 30))
  // Split at 40: two reversed clips that play what the one did.
  const split = await call('split_at', { frame: 40, itemIds: [f.a] })
  assert.ok(split.ok, split.ok ? '' : split.error)
  const pieces = state().project.timelines[0]!.tracks[0]!.items.filter((i) => i.from < 90)
  assert.equal(pieces.length, 2)
  for (const piece of pieces) {
    assert.equal(piece.reverse, true)
    for (let frame = piece.from; frame < itemEnd(piece); frame += 1) {
      assert.ok(Math.abs(sourceTimeAt(piece, frame, 30) - before.get(frame)!) <= 2, `frame ${frame}`)
    }
  }
})

test('dragging a reversed clip’s edges keeps the rest on its footage and stops where the footage does', () => {
  const f = load()
  state().retimeClip(f.a, { reverse: true })
  const before = new Map<number, number>()
  for (let frame = 0; frame < 90; frame += 1) before.set(frame, sourceTimeAt(clipOf(f.a), frame, 30))
  // Head in by 30: frames 30…89 play what they played.
  state().trimItem(f.a, 'start', 30)
  assert.equal(clipOf(f.a).from, 30)
  assert.equal(clipOf(f.a).durationInFrames, 60)
  for (let frame = 30; frame < 90; frame += 1) assert.equal(sourceTimeAt(clipOf(f.a), frame, 30), before.get(frame), `frame ${frame}`)
  // Head back out by 30: the first 30 frames are what they were.
  state().trimItem(f.a, 'start', 0)
  for (let frame = 0; frame < 90; frame += 1) assert.equal(sourceTimeAt(clipOf(f.a), frame, 30), before.get(frame), `frame ${frame} after trimming back`)
  // Tail out: a reversed clip reads down to the start of its file — 2 s more, 60 frames — and stops.
  state().trimItem(f.a, 'end', 190)
  assert.equal(clipOf(f.a).durationInFrames, 150, 'it stops where the file starts, not where it was dragged')
  assert.equal(sourceTimeAt(clipOf(f.a), 149, 30), 0)
  // The forward twin of the same drag stops at the next clip's start instead — its footage runs on.
  const g = load()
  state().trimItem(g.a, 'end', 190)
  assert.equal(clipOf(g.a).durationInFrames, 190)
})

test('an adjustment layer has no footage: reverse and speedRamp are refused on it with why, and its own fields still set', async () => {
  load()
  const added = await call('add_adjustment_layer', {})
  assert.ok(added.ok, added.ok ? '' : added.error)
  const layer = state().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => state().project.assets.find((a) => a.id === i.assetId)?.kind === 'adjustment')
  assert.ok(layer, 'the layer is on the timeline')
  const before = JSON.stringify(state().project.timelines)
  for (const [args, named] of [[{ reverse: true }, 'reverse'], [{ speedRamp: 'ramp-down' }, 'speedRamp'], [{ reverse: true, speedRamp: 'hold' }, 'reverse, speedRamp']] as const) {
    const refused = await call('edit_item', { itemId: layer.id, ...args })
    assert.equal(refused.ok, false, named)
    assert.match(refused.ok ? '' : refused.error, new RegExp(`is an adjustment layer: .* no footage or sound of its own, so ${named} do(es)? nothing on it`), named)
    assert.match(refused.ok ? '' : refused.error, /It takes from, durationInFrames, trackId, opacity/)
    assert.equal(JSON.stringify(state().project.timelines), before, 'a refused call changes nothing')
  }
  // The twin: a field it does read is set.
  const dimmed = await call('edit_item', { itemId: layer.id, opacity: 0.5 })
  assert.ok(dimmed.ok, dimmed.ok ? '' : dimmed.error)
  // And the store's own plan, which the inspector calls, leaves it unreversed too.
  state().retimeClip(layer.id, { reverse: true, ramp: [{ frame: 0, value: 0.5 }] })
  const after = state().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === layer.id)!
  assert.equal(after.reverse, undefined)
  assert.equal(after.keyframes?.speed, undefined)
})

test('apply_script moves a reversed clip, and is sent to trim_item when it tries to retime one', async () => {
  const f = load()
  await call('edit_item', { itemId: f.a, reverse: true })
  const text = renderScript(state().project, state().project.timelines[0]!.id)
  const lines = text.split('\n')
  const index = lines.findIndex((line) => line.includes('00:00:00:00') && line.includes('00:00:03:00'))
  assert.ok(index >= 0, `the reversed clip's line, 0 to 3 s:\n${text}`)
  const rewrite = (from: string, to: string): string =>
    lines.map((line, i) => (i === index ? line.replace('00:00:00:00', from).replace('00:00:03:00', to) : line)).join('\n')

  // A tail trim: refused, naming the clip, the reason and the tool that does it.
  const before = JSON.stringify(state().project.timelines)
  const trimmed = await call('apply_script', { script: rewrite('00:00:00:00', '00:00:02:00') })
  assert.equal(trimmed.ok, false)
  assert.match(trimmed.ok ? '' : trimmed.error, new RegExp(`is reversed, so the script can move it but not tail trim it.*trim_item.*${f.a}`))
  assert.equal(JSON.stringify(state().project.timelines), before)

  // The twin: the same line moved whole is applied, and the clip is still reversed on its footage.
  const span = sourceSpanOf(clipOf(f.a), 30)
  const moved = await call('apply_script', { script: rewrite('00:00:03:10', '00:00:06:10') })
  assert.ok(moved.ok, moved.ok ? '' : moved.error)
  assert.equal(clipOf(f.a).from, 100)
  assert.equal(clipOf(f.a).reverse, true)
  assert.deepEqual(sourceSpanOf(clipOf(f.a), 30), span)
})
