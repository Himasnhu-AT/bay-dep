/**
 * Keyframes through the real tools and store actions: that each edit keeps keys where a person
 * expects them, stated as what the picture does rather than what the stored numbers are.
 *
 * The requirement for every rule is written in `@shared/keyframes`; each test here checks it by
 * sampling the animation at every timeline frame before and after the edit — "the clip still
 * zooms the same way over the same footage" — so a rule broken in a way that happens to leave
 * the numbers plausible still fails.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/renderer/src/mcp/keyframes.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findItem, type Asset, type Item, type Project, type Track } from '@shared/project'
import { animatedLayoutAt, animatedVolumeAt } from '@shared/keyframes'
import { useEditor, emptyProject, newId } from '@/store/editor'
import { executeToolCall } from './index'

const VIDEO: Asset = {
  id: 'ast_video',
  kind: 'video',
  name: 'take.mp4',
  path: '/footage/take.mp4',
  durationUs: 60_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 1
}

const STILL: Asset = { ...VIDEO, id: 'ast_still', kind: 'image', name: 'card.png', path: '/footage/card.png', durationUs: 0, hasAudio: false }

function clip(from: number, durationInFrames: number, sourceStartUs: number, assetId = VIDEO.id): Item {
  return {
    id: newId('itm'),
    assetId,
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

function track(kind: 'video' | 'audio', name: string, items: Item[]): Track {
  const id = newId('trk')
  return { id, kind, name, locked: false, muted: false, hidden: false, items: items.map((i) => ({ ...i, trackId: id })) }
}

/** V1: A (0-150) abutting B (150-300), both with handles. V2: a still. A1: music, 0-600. */
function load(): { a: string; b: string; still: string; music: string } {
  const project: Project = emptyProject()
  const v1 = track('video', 'V1', [clip(0, 150, 5_000_000), clip(150, 150, 20_000_000)])
  const v2 = track('video', 'V2', [clip(0, 90, 0, STILL.id)])
  const a1 = track('audio', 'A1', [clip(0, 600, 0)])
  project.timelines[0]!.tracks = [v1, v2, a1]
  project.assets = [VIDEO, STILL]
  useEditor.getState().enterProject(project)
  return { a: v1.items[0]!.id, b: v1.items[1]!.id, still: v2.items[0]!.id, music: a1.items[0]!.id }
}

async function call(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await executeToolCall({ id: newId('call'), tool, args })
  if (!result.ok) throw new Error(`${tool} failed: ${result.error}`)
  return result.value as Record<string, unknown>
}

async function refusal(tool: string, args: Record<string, unknown>): Promise<string> {
  const result = await executeToolCall({ id: newId('call'), tool, args })
  assert.equal(result.ok, false, `${tool} ${JSON.stringify(args)} should have been refused`)
  return (result as { error: string }).error
}

function current(id: string): Item | undefined {
  const s = useEditor.getState()
  return findItem(s.project.timelines[0]!, id)?.item
}

function all(): Item[] {
  return useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items)
}

/** The scale on screen at timeline frame `f`: from whichever clip on V1 covers it. */
function scaleAt(ids: string[], f: number): number | undefined {
  for (const id of ids) {
    const it = current(id)
    if (it && f >= it.from && f < it.from + it.durationInFrames) return animatedLayoutAt(it, f).scale
  }
  return undefined
}

/** A curve with an ease, a hold and a key mid-clip, so a shifted or truncated list reads differently. */
const CURVE = {
  scale: [
    { frame: 0, value: 1, ease: 'inOut' },
    { frame: 40, value: 1.2, ease: 'hold' },
    { frame: 90, value: 1.1 },
    { frame: 150, value: 1.3 }
  ]
}

async function keyed(id: string): Promise<void> {
  await call('edit_item', { itemId: id, keyframes: CURVE })
}

test('edit_item writes keys in one undo step; inspect_item reads them back in timeline frames', async () => {
  const { b } = load()
  const before = useEditor.getState().past.length
  const result = await call('edit_item', { itemId: b, keyframes: { scale: [{ frame: 0, value: 1 }, { frame: 150, value: 1.04 }] } })
  assert.equal(useEditor.getState().past.length, before + 1)
  assert.deepEqual((result.animation as Record<string, unknown>).scale, { keys: 2, timelineFrames: [150, 300], values: [1, 1.04] })
  const inspected = await call('inspect_item', { itemId: b })
  assert.deepEqual(inspected.keyframes, { scale: [{ frame: 0, value: 1 }, { frame: 150, value: 1.04 }] })
  assert.ok(Math.abs(scaleAt([b], 225)! - 1.02) < 1e-12, 'half-way through the clip, half-way through the push')
  useEditor.getState().undo()
  assert.equal(current(b)!.keyframes, undefined)
})

test('a refused key names the frame range in timeline frames, and changes nothing', async () => {
  const { b } = load()
  const before = useEditor.getState().past.length
  const error = await refusal('edit_item', { itemId: b, keyframes: { opacity: [{ frame: 300, value: 0 }] } })
  assert.match(error, /keyframes\.opacity\[0\]\.frame is 300/)
  assert.match(error, /timeline frame 150/)
  assert.match(error, /T - 150/)
  assert.equal(useEditor.getState().past.length, before)
  assert.equal(current(b)!.keyframes, undefined)
  // Positive control: the same key inside the clip is accepted.
  await call('edit_item', { itemId: b, keyframes: { opacity: [{ frame: 149, value: 0 }] } })
  assert.equal(current(b)!.keyframes!.opacity!.length, 1)
})

test('volume keys on a still are refused; on a clip with sound they ride its gain', async () => {
  const { still, music } = load()
  assert.match(await refusal('edit_item', { itemId: still, keyframes: { volume: [{ frame: 0, value: 0.5 }] } }), /has no sound/)
  await call('edit_item', { itemId: music, keyframes: { volume: [{ frame: 285, db: 0 }, { frame: 300, db: -12 }, { frame: 420, db: -12 }, { frame: 435, db: 0 }] } })
  const m = current(music)!
  assert.equal(animatedVolumeAt(m, 100), 1)
  assert.ok(Math.abs(20 * Math.log10(animatedVolumeAt(m, 360)) + 12) < 1e-9)
  assert.equal(animatedVolumeAt(m, 500), 1)
})

test('a static value set over keys is stored and said to change nothing', async () => {
  const { a } = load()
  await keyed(a)
  const result = await call('edit_item', { itemId: a, scale: 2, opacity: 0.5 })
  const warnings = (result.warnings as string[] | undefined) ?? []
  assert.ok(warnings.some((w) => /scale 2 is stored but changes nothing/.test(w) && /keyframes: \{ scale: null \}/.test(w)), JSON.stringify(warnings))
  assert.ok(!warnings.some((w) => /^opacity/.test(w)), 'opacity has no keys, so setting it is an ordinary edit')
})

test('split_at divides keys so both halves draw exactly what the clip did', async () => {
  const { a } = load()
  await keyed(a)
  const whole = Array.from({ length: 150 }, (_, f) => scaleAt([a], f))
  for (const cut of [20, 65, 100]) {
    load()
    const ids = all().map((i) => i.id)
    const target = ids[0]!
    await keyed(target)
    await call('split_at', { frame: cut, itemIds: [target] })
    const pieces = all().filter((i) => i.trackId === current(target)!.trackId).map((i) => i.id)
    assert.equal(pieces.length, 3, 'A split in two, B untouched')
    for (let f = 0; f < 150; f += 1) assert.equal(scaleAt(pieces, f), whole[f], `cut ${cut}, frame ${f}`)
  }
})

test('trimming the in-point keeps keys on the footage; trimming the out-point moves nothing', () => {
  const { a } = load()
  return keyed(a).then(() => {
    const before = Array.from({ length: 150 }, (_, f) => scaleAt([a], f))
    useEditor.getState().trimItem(a, 'start', 30)
    assert.equal(current(a)!.from, 30)
    for (let f = 30; f < 150; f += 1) assert.equal(scaleAt([a], f), before[f], `frame ${f}`)
    const keysAfterHead = structuredClone(current(a)!.keyframes)
    useEditor.getState().trimItem(a, 'end', 120)
    assert.deepEqual(current(a)!.keyframes, keysAfterHead)
  })
})

test('roll: the incoming clip\'s keys stay on the timeline, the outgoing clip\'s are untouched', async () => {
  const { a, b } = load()
  await keyed(a)
  await keyed(b)
  const before = Array.from({ length: 300 }, (_, f) => scaleAt([a, b], f))
  await call('trim_item', { itemId: a, mode: 'roll', deltaFrames: 12 })
  assert.equal(current(b)!.from, 162)
  for (let f = 0; f < 150; f += 1) assert.equal(scaleAt([a], f), before[f], `outgoing frame ${f}`)
  for (let f = 162; f < 300; f += 1) assert.equal(scaleAt([b], f), before[f], `incoming frame ${f}`)
})

test('slide: the clip carries its keys; the neighbour whose in-point moved keeps its own in place', async () => {
  const { a, b } = load()
  await keyed(a)
  await keyed(b)
  const beforeA = Array.from({ length: 150 }, (_, f) => scaleAt([a], f))
  const beforeB = Array.from({ length: 300 }, (_, f) => scaleAt([b], f))
  await call('trim_item', { itemId: a, mode: 'slide', deltaFrames: 10 })
  assert.equal(current(a)!.from, 10)
  for (let f = 0; f < 150; f += 1) assert.equal(scaleAt([a], f + 10), beforeA[f], `moved clip frame ${f}`)
  for (let f = 160; f < 300; f += 1) assert.equal(scaleAt([b], f), beforeB[f], `neighbour frame ${f}`)
})

test('slip and speed change what plays, not where the animation is', async () => {
  const { a } = load()
  await keyed(a)
  const keys = structuredClone(current(a)!.keyframes)
  await call('trim_item', { itemId: a, mode: 'slip', deltaFrames: -30 })
  assert.deepEqual(current(a)!.keyframes, keys)
  await call('edit_item', { itemId: a, speed: 2 })
  assert.equal(current(a)!.durationInFrames, 150)
  assert.deepEqual(current(a)!.keyframes, keys)
})

test('remove_range out of the middle of a clip: head and tail keep the animation of their footage', async () => {
  const { a, b } = load()
  await keyed(a)
  const before = Array.from({ length: 150 }, (_, f) => scaleAt([a], f))
  await call('remove_range', { fromFrame: 50, toFrame: 80 })
  const pieces = all().filter((i) => i.trackId === current(a)!.trackId && i.id !== b).map((i) => i.id)
  assert.equal(pieces.length, 2)
  for (let f = 0; f < 50; f += 1) assert.equal(scaleAt(pieces, f), before[f], `head frame ${f}`)
  for (let f = 50; f < 120; f += 1) assert.equal(scaleAt(pieces, f), before[f + 30], `tail frame ${f}`)
})

test('remove_range over a clip\'s head: the tail lands on the cut still animated as its footage was', async () => {
  const { a, b } = load()
  await keyed(b)
  const before = Array.from({ length: 300 }, (_, f) => scaleAt([b], f))
  await call('remove_range', { fromFrame: 100, toFrame: 200 })
  assert.equal(current(b)!.from, 100)
  assert.ok(current(a))
  for (let f = 100; f < 200; f += 1) assert.equal(scaleAt([b], f), before[f + 100], `frame ${f}`)
})

test('apply_script: a head trim keeps keys on their footage; a move carries them', async () => {
  const { a, b } = load()
  await keyed(a)
  await keyed(b)
  const beforeA = Array.from({ length: 150 }, (_, f) => scaleAt([a], f))
  const beforeB = Array.from({ length: 300 }, (_, f) => scaleAt([b], f))
  const read = await executeToolCall({ id: newId('call'), tool: 'read_script', args: {} })
  assert.ok(read.ok, JSON.stringify(read))
  const script = read.value as unknown as string
  const lineOf = (id: string): string => {
    const line = script.split('\n').find((l) => {
      const shown = /^- \[([^\]]+)\]/.exec(l)?.[1]
      return shown !== undefined && id.startsWith(shown)
    })
    assert.ok(line, `no script line for ${id}:\n${script}`)
    return line
  }
  // A: only `in` moves (0 -> 30): a head trim. B: `in` and `out` both +30: a move.
  const aLine = lineOf(a)
  const bLine = lineOf(b)
  assert.ok(aLine.includes('00:00:00:00 → 00:00:05:00'), aLine)
  assert.ok(bLine.includes('00:00:05:00 → 00:00:10:00'), bLine)
  const edited = script
    .replace(aLine, aLine.replace('00:00:00:00 → 00:00:05:00', '00:00:01:00 → 00:00:05:00'))
    .replace(bLine, bLine.replace('00:00:05:00 → 00:00:10:00', '00:00:06:00 → 00:00:11:00'))
  assert.notEqual(edited, script, 'the edit must land in the script')
  await call('apply_script', { script: edited })
  assert.equal(current(a)!.from, 30)
  assert.equal(current(b)!.from, 180)
  for (let f = 30; f < 150; f += 1) assert.equal(scaleAt([a], f), beforeA[f], `head-trimmed frame ${f}`)
  for (let f = 150; f < 300; f += 1) assert.equal(scaleAt([b], f + 30), beforeB[f], `moved frame ${f}`)
})
