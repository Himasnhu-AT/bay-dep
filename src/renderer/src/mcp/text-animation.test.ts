/**
 * Text styling, looks and animation presets through the real tools and store actions.
 *
 * `edit_item` and `apply_text_look` are driven through the dispatcher (schema validation and
 * all); trims, splits and range cuts through the store actions a person's edit goes through. Each
 * rule is read off what the clip then draws (`animatedItemAt`, the compositor's own sampler) or
 * off the stored document, never off the tool's echo alone. Every refusal sits beside the nearest
 * call that is accepted, and is checked for what it tells the caller to send instead.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/renderer/src/mcp/text-animation.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findItem, type Asset, type Item, type Project, type TextStyle, type Track } from '@shared/project'
import { animatedItemAt } from '@shared/keyframes'
import { TEXT_LOOKS, applyTextLook, findTextLook } from '@shared/text-style'
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
const TITLE: Asset = { ...VIDEO, id: 'ast_title', kind: 'text', name: 'Hello there', path: null, text: 'Hello there', durationUs: 0, hasAudio: false, hasVideo: false }

/** A title's style as builds before the paint stack stored it: these twelve keys, in this order. */
const LEGACY_STYLE =
  '{"fontFamily":"Georgia, serif","fontSize":72,"fontWeight":700,"italic":false,"color":"#FFEEDD",' +
  '"align":"left","verticalAlign":"bottom","lineHeight":1.1,"letterSpacing":2,' +
  '"stroke":{"color":"#000000","width":6},"shadow":null,"background":null}'

function clip(from: number, durationInFrames: number, sourceStartUs: number, assetId = VIDEO.id): Item {
  return {
    id: newId('itm'),
    assetId,
    trackId: '',
    from,
    durationInFrames,
    sourceStartUs,
    layout: { left: 100, top: 200, width: 800, height: 300, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...(assetId === TITLE.id ? { text: JSON.parse(LEGACY_STYLE) as TextStyle } : {})
  }
}

function track(kind: 'video' | 'audio', name: string, items: Item[], locked = false): Track {
  const id = newId('trk')
  return { id, kind, name, locked, muted: false, hidden: false, items: items.map((i) => ({ ...i, trackId: id })) }
}

interface Fixture {
  a: string
  b: string
  t1: string
  t2: string
  locked: string
  music: string
  v1: string
  titles: string
  lockedTrack: string
  fps: number
}

/** V1: A (0-150) abutting B (150-300). Titles: two titles. Locked: one more title. A1: music. */
function load(): Fixture {
  const project: Project = emptyProject()
  const v1 = track('video', 'V1', [clip(0, 150, 5_000_000), clip(150, 150, 20_000_000)])
  const titles = track('video', 'Titles', [clip(0, 90, 0, TITLE.id), clip(100, 90, 0, TITLE.id)])
  const lockedTrack = track('video', 'Credits', [clip(0, 60, 0, TITLE.id)], true)
  const a1 = track('audio', 'A1', [clip(0, 600, 0)])
  project.timelines[0]!.tracks = [v1, titles, lockedTrack, a1]
  project.assets = [VIDEO, TITLE]
  useEditor.getState().enterProject(project)
  return {
    a: v1.items[0]!.id,
    b: v1.items[1]!.id,
    t1: titles.items[0]!.id,
    t2: titles.items[1]!.id,
    locked: lockedTrack.items[0]!.id,
    music: a1.items[0]!.id,
    v1: v1.id,
    titles: titles.id,
    lockedTrack: lockedTrack.id,
    fps: project.timelines[0]!.fps
  }
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

const current = (id: string): Item => {
  const found = findItem(useEditor.getState().project.timelines[0]!, id)?.item
  assert.ok(found, `item ${id} is gone`)
  return found
}
const all = (): Item[] => useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items)
const past = (): number => useEditor.getState().past.length
const warnings = (result: Record<string, unknown>): string[] => (result.warnings as string[] | undefined) ?? []

// -- the stored form ----------------------------------------------------------------------------

test('editing one single field of an old title stores the same twelve keys in the same order — nothing new appears', async () => {
  const f = load()
  assert.equal(JSON.stringify(current(f.t1).text), LEGACY_STYLE, 'the specimen is the old document')
  // Derived, not a literal: whatever the colour is now, set a different one and set it back.
  const was = current(f.t1).text!.color
  const other = was === '#00FF88' ? '#FF0055' : '#00FF88'
  await call('edit_item', { itemId: f.t1, text: { color: other } })
  assert.equal(JSON.stringify(current(f.t1).text), LEGACY_STYLE.replace(was, other))
  await call('edit_item', { itemId: f.t1, text: { color: was } })
  assert.equal(JSON.stringify(current(f.t1).text), LEGACY_STYLE, 'byte for byte what it was')
  // The positive control: a stack field does add a key, so the comparison above can fail.
  await call('edit_item', { itemId: f.t1, text: { glow: { color: '#39E6FF', blur: 20 } } })
  assert.notEqual(JSON.stringify(current(f.t1).text), LEGACY_STYLE)
  await call('edit_item', { itemId: f.t1, text: { glow: null } })
  assert.equal(JSON.stringify(current(f.t1).text), LEGACY_STYLE, 'and removing it leaves no trace')
})

// -- the stack through edit_item ------------------------------------------------------------------

test('edit_item stores a paint stack as sent, replaces each field whole, and refuses a bad layer by its path', async () => {
  const f = load()
  const result = await call('edit_item', {
    itemId: f.t1,
    text: {
      fills: [{ kind: 'linear', angle: 90, stops: [{ at: 0, color: '#ffd36e' }, { at: 1, color: '#7a5cff' }] }],
      strokes: [{ color: '#FFFFFF', width: 4 }],
      shadows: [{ color: '#000000', blur: 0, offsetX: 4, offsetY: 4 }],
      background: { color: '#000000CC', padding: 12, radius: 6 },
      plate: { perLine: true }
    }
  })
  const text = current(f.t1).text!
  assert.deepEqual(text.fills, [{ kind: 'linear', angle: 90, stops: [{ at: 0, color: '#FFD36E' }, { at: 1, color: '#7A5CFF' }] }])
  assert.deepEqual(text.plate, { perLine: true })
  assert.deepEqual((result.text as TextStyle).strokes, text.strokes, 'the result is the stored style')
  assert.equal(text.stroke?.width, 6, 'the single outline it already had is kept under the new one')
  // Replaced whole, not merged layer by layer.
  await call('edit_item', { itemId: f.t1, text: { strokes: [{ color: '#FF0000', width: 2 }, { color: '#00FF00', width: 2 }] } })
  assert.deepEqual(current(f.t1).text!.strokes!.map((stroke) => stroke.color), ['#FF0000', '#00FF00'])

  const before = JSON.stringify(current(f.t1))
  const error = await refusal('edit_item', { itemId: f.t1, text: { fills: [{ kind: 'solid', color: '#FFFFFF' }, { kind: 'solid', color: 'white' }] } })
  assert.match(error, /"text\.fills"\[1\]\.color must be a hex colour such as "#FFFFFF"/)
  assert.equal(JSON.stringify(current(f.t1)), before, 'a refused call changes nothing')
  assert.match(await refusal('edit_item', { itemId: f.a, text: { glow: { color: '#FFFFFF', blur: 10 } } }), /no type to style/)
})

// -- looks ----------------------------------------------------------------------------------------

test('a look by name sets the paint and keeps the title\'s font, size and place; other fields in the call are changes to the look', async () => {
  const f = load()
  await call('edit_item', { itemId: f.t1, text: { look: 'neon' } })
  const worn = current(f.t1).text!
  assert.deepEqual(worn, applyTextLook(JSON.parse(LEGACY_STYLE) as TextStyle, findTextLook('neon')!))
  assert.equal(worn.fontFamily, 'Georgia, serif')
  assert.equal(worn.fontSize, 72)
  assert.equal(worn.align, 'left')
  assert.equal('look' in worn, false, 'the look\'s name is not stored — its fields are')

  await call('edit_item', { itemId: f.t2, text: { look: 'neon', glow: { color: '#FF66CC', blur: 40 } } })
  assert.deepEqual(current(f.t2).text!.glow, { color: '#FF66CC', blur: 40 }, 'the field in the same call wins over the look')
  assert.deepEqual(current(f.t2).text!.fills, worn.fills)

  const error = await refusal('edit_item', { itemId: f.t1, text: { look: 'vaporwave' } })
  for (const look of TEXT_LOOKS) assert.ok(error.includes(`"${look.id}"`), `the refusal offers ${look.id}`)
})

test('apply_text_look restyles every title in scope as one undo step, skipping a locked track and saying so', async () => {
  const f = load()
  const before = JSON.stringify(useEditor.getState().project)
  const steps = past()
  const result = await call('apply_text_look', { look: 'caption-bold', all: true })
  assert.equal(past() - steps, 1)
  assert.deepEqual((result.changedItemIds as string[]).sort(), [f.t1, f.t2].sort())
  assert.deepEqual(result.skippedLocked, [f.locked])
  assert.match(String(result.warning), /1 title on locked track \(Credits\) kept its old look/)
  const look = findTextLook('caption-bold')!
  for (const id of [f.t1, f.t2]) assert.deepEqual(current(id).text, applyTextLook(JSON.parse(LEGACY_STYLE) as TextStyle, look))
  assert.equal(JSON.stringify(current(f.locked).text), LEGACY_STYLE, 'the locked title is untouched')
  assert.equal(current(f.a).text, undefined, 'a video clip is not given a text style')
  useEditor.getState().undo()
  assert.equal(JSON.stringify(useEditor.getState().project.timelines), JSON.stringify((JSON.parse(before) as Project).timelines), 'one undo takes all of it back')
})

test('apply_text_look copies the look of a title onto a track — font included — and names what it cannot do', async () => {
  const f = load()
  await call('edit_item', { itemId: f.t1, text: { look: 'double-outline', fontFamily: 'Futura, sans-serif', fontSize: 144 } })
  const result = await call('apply_text_look', { fromItemId: f.t1, trackId: f.titles })
  assert.deepEqual(result.changedItemIds, [f.t2], 'the title it is copied from already wears it')
  const source = current(f.t1).text!
  const copy = current(f.t2).text!
  assert.equal(copy.fontFamily, 'Futura, sans-serif')
  assert.equal(copy.color, source.color)
  assert.equal(copy.fontSize, 72, 'its own size is kept')
  assert.equal(copy.stroke!.width, source.stroke!.width / 2, 'half the size, half the outline')

  // Refusals, each beside the call above that worked.
  assert.match(await refusal('apply_text_look', { look: 'neon', fromItemId: f.t1, all: true }), /exactly one of look or fromItemId/)
  assert.match(await refusal('apply_text_look', { look: 'neon' }), /Say which titles, one way: itemIds.*trackId.*all: true/)
  const notTitle = await refusal('apply_text_look', { look: 'neon', itemIds: [f.t1, f.a] })
  assert.ok(notTitle.includes(f.a) && /is not a title/.test(notTitle) && /trackId or all: true/.test(notTitle), notTitle)
  const empty = await refusal('apply_text_look', { look: 'neon', trackId: f.v1 })
  assert.match(empty, /Track V1 .* has no titles on it\. Tracks with titles: Titles/)
  assert.ok(empty.includes(f.titles), 'it names the track id to use instead')
  assert.match(await refusal('apply_text_look', { look: 'neon', trackId: f.lockedTrack }), /locked track \(Credits\).*Unlock the track first/)
  assert.match(await refusal('apply_text_look', { fromItemId: f.a, all: true }), /is not a title, so it has no look to copy/)
})

// -- animation presets ------------------------------------------------------------------------------

test('edit_item stores a preset in frames at the timeline\'s rate and reports the timeline frames it occupies', async () => {
  const f = load()
  const result = await call('edit_item', { itemId: f.a, animation: { in: { kind: 'slide', from: 'right', seconds: 0.5 }, out: { kind: 'fade', frames: 12 } } })
  const frames = Math.round(0.5 * f.fps)
  assert.deepEqual(current(f.a).animation, { in: { kind: 'slide', frames, from: 'right' }, out: { kind: 'fade', frames: 12 } })
  const presets = result.presets as { plays: { in: { timelineFrames: number[] }; out: { timelineFrames: number[] } } }
  assert.deepEqual(presets.plays.in.timelineFrames, [0, frames])
  assert.deepEqual(presets.plays.out.timelineFrames, [138, 150])
  assert.deepEqual(warnings(result).filter((w) => /animation|preset/i.test(w)), [], 'nothing to warn about: there is no transition and both fit')
  // What it draws: off to the right at its first frame, home once the In is over.
  assert.ok(animatedItemAt(current(f.a), 0).layout.left > 100)
  assert.equal(animatedItemAt(current(f.a), frames).layout.left, 100)
  // inspect_item reads the same thing back.
  const inspected = await call('inspect_item', { itemId: f.a })
  assert.deepEqual((inspected.presets as { in: unknown }).in, { kind: 'slide', frames, from: 'right' })
  // And null takes it all off again.
  await call('edit_item', { itemId: f.a, animation: null })
  assert.equal('animation' in current(f.a), false)
})

test('a preset is refused on a clip that cannot show it, with what to use instead', async () => {
  const f = load()
  assert.match(await refusal('edit_item', { itemId: f.music, animation: { in: { kind: 'fade' } } }), /sound-only clip.*fadeInFrames/)
  assert.match(await refusal('edit_item', { itemId: f.a, animation: { in: { kind: 'typewriter' } } }), /is not a title\. Use "wipe"/)
  assert.match(await refusal('edit_item', { itemId: f.a, animation: { in: { kind: 'rise', by: 'word' } } }), /is not a title\. Leave by out/)
  // The same three on a title, or without the title-only part, are accepted.
  await call('edit_item', { itemId: f.t1, animation: { in: { kind: 'typewriter' }, out: { kind: 'rise', by: 'word' } } })
  assert.equal(current(f.t1).animation?.in?.kind, 'typewriter')
  assert.equal(current(f.t1).animation?.out?.by, 'word')
  await call('edit_item', { itemId: f.a, animation: { in: { kind: 'rise' } } })
  assert.equal(current(f.a).animation?.in?.kind, 'rise')
})

test('a clip too short for its In and Out is told how they will share it, and stores what was asked', async () => {
  const f = load()
  await call('edit_item', { itemId: f.t1, durationInFrames: 20 })
  const result = await call('edit_item', { itemId: f.t1, animation: { in: { kind: 'fade', frames: 15 }, out: { kind: 'fade', frames: 15 } } })
  assert.equal(warnings(result).filter((w) => /in 15 \+ out 15.*in 10 and out 10/.test(w)).length, 1, JSON.stringify(warnings(result)))
  assert.equal(current(f.t1).animation?.in?.frames, 15)
  const plays = (result.presets as { plays: { in: { timelineFrames: number[] }; out: { timelineFrames: number[] } } }).plays
  assert.deepEqual([plays.in.timelineFrames, plays.out.timelineFrames], [[0, 10], [10, 20]])
  // The twin: the other title is long enough, and gets no such warning.
  const roomy = await call('edit_item', { itemId: f.t2, animation: { in: { kind: 'fade', frames: 15 }, out: { kind: 'fade', frames: 15 } } })
  assert.deepEqual(warnings(roomy).filter((w) => /shortened/.test(w)), [])
})

test('where a transition crosses an end the preset there is stored but set aside, and the result says so', async () => {
  const f = load()
  await call('add_transition', { fromItemId: f.a, toItemId: f.b, kind: 'cross-dissolve', durationInFrames: 20 })
  const result = await call('edit_item', { itemId: f.a, animation: { in: { kind: 'fade', frames: 10 }, out: { kind: 'slide', frames: 10 } } })
  const said = warnings(result).filter((w) => /does not play/.test(w))
  assert.equal(said.length, 1, JSON.stringify(warnings(result)))
  assert.match(said[0]!, /animation\.out \("slide"\) is stored but does not play: a transition crosses this clip's last frame.*remove_transition/)
  assert.deepEqual(current(f.a).animation?.out, { kind: 'slide', frames: 10 }, 'stored all the same')
  // The incoming clip: its In is the one set aside.
  const incoming = await call('edit_item', { itemId: f.b, animation: { in: { kind: 'pop', frames: 10 } } })
  assert.match(warnings(incoming).find((w) => /does not play/.test(w)) ?? '', /animation\.in \("pop"\).*first frame/)
})

test('a head trim, a tail trim and a move all leave the In on the first frames and the Out on the last', async () => {
  const f = load()
  await call('edit_item', { itemId: f.t2, animation: { in: { kind: 'slide', from: 'bottom', frames: 10 }, out: { kind: 'fade', frames: 10 } } })
  const stored = JSON.stringify(current(f.t2).animation)
  const shape = (): { head: number; settled: number; tail: number } => {
    const it = current(f.t2)
    return {
      head: animatedItemAt(it, it.from).layout.top,
      settled: animatedItemAt(it, it.from + 10).layout.top,
      tail: animatedItemAt(it, it.from + it.durationInFrames - 1).layout.opacity
    }
  }
  const before = shape()
  assert.ok(before.head > 200 && before.settled === 200 && before.tail < 0.2, JSON.stringify(before))

  useEditor.getState().trimItem(f.t2, 'start', 120)
  assert.equal(current(f.t2).from, 120, 'the specimen: the head really moved')
  assert.deepEqual(shape(), before)
  useEditor.getState().trimItem(f.t2, 'end', 165)
  assert.equal(current(f.t2).durationInFrames, 45)
  assert.deepEqual(shape(), before)
  await call('edit_item', { itemId: f.t2, from: 300 })
  assert.deepEqual(shape(), before)
  assert.equal(JSON.stringify(current(f.t2).animation), stored, 'and none of it rewrote the preset')
})

test('split_at and remove_range leave the In on the first piece and the Out on the last, with no pop at the cut', async () => {
  const f = load()
  const animation = { in: { kind: 'pop', frames: 10 }, out: { kind: 'fade', frames: 10 }, loop: { kind: 'pulse', frames: 40 } }
  await call('edit_item', { itemId: f.t1, animation })
  await call('split_at', { frame: 40, itemIds: [f.t1] })
  const pieces = all().filter((it) => it.assetId === TITLE.id && it.trackId === f.titles && it.from < 90).sort((x, y) => x.from - y.from)
  assert.equal(pieces.length, 2)
  assert.deepEqual(pieces[0]!.animation, { in: animation.in, loop: animation.loop })
  assert.deepEqual(pieces[1]!.animation, { out: animation.out, loop: animation.loop })

  // A range cut out of the middle of one clip: the same rule through the ripple path.
  await call('edit_item', { itemId: f.a, animation: { in: { kind: 'fade', frames: 10 }, out: { kind: 'fade', frames: 10 } } })
  await call('remove_range', { fromFrame: 60, toFrame: 80 })
  const halves = all().filter((it) => it.trackId === f.v1 && it.from < 130).sort((x, y) => x.from - y.from)
  assert.equal(halves.length, 2, 'the specimen: the range fell inside one clip and made two')
  assert.deepEqual(halves[0]!.animation, { in: { kind: 'fade', frames: 10 } })
  assert.deepEqual(halves[1]!.animation, { out: { kind: 'fade', frames: 10 } })
  assert.equal(animatedItemAt(halves[1]!, halves[1]!.from).layout.opacity, 1, 'the tail does not fade in at the cut')
})

// -- keys on the newer properties ---------------------------------------------------------------------

test('edit_item keys a blur, a crop edge and a title\'s size, each only where it can change something', async () => {
  const f = load()
  const result = await call('edit_item', { itemId: f.a, keyframes: { blur: [{ frame: 0, value: 20 }, { frame: 30, value: 0 }], cropLeft: [{ frame: 0, value: 0 }, { frame: 150, value: 0.2 }] } })
  const shown = animatedItemAt(current(f.a), 15)
  assert.equal(shown.adjustments?.blur, 10)
  assert.ok(Math.abs(shown.crop!.left - 0.02) < 1e-9)
  assert.deepEqual((result.animation as Record<string, { timelineFrames: number[] }>).blur!.timelineFrames, [0, 30])

  assert.match(await refusal('edit_item', { itemId: f.a, keyframes: { fontSize: [{ frame: 0, value: 40 }] } }), /not a title.*key scale instead/)
  await call('edit_item', { itemId: f.t1, keyframes: { fontSize: [{ frame: 0, value: 40 }, { frame: 90, value: 80 }] } })
  assert.equal(animatedItemAt(current(f.t1), 45).text?.fontSize, 60)
  assert.match(await refusal('edit_item', { itemId: f.t1, keyframes: { cropLeft: [{ frame: 0, value: 0.1 }] } }), /a crop cuts a source picture/)

  // A static value set under keys is stored and drawn nowhere — said, wherever the field lives.
  const shadowed = await call('edit_item', { itemId: f.a, adjustments: { blur: 5 } })
  assert.match(warnings(shadowed).find((w) => /^blur/.test(w)) ?? '', /blur 5 is stored but changes nothing: blur has 2 keyframes/)
  const clear = await call('edit_item', { itemId: f.a, adjustments: { contrast: 1.1 } })
  assert.deepEqual(warnings(clear).filter((w) => /changes nothing: contrast/.test(w)), [], 'the twin: an adjustment with no keys is not warned about')
})
