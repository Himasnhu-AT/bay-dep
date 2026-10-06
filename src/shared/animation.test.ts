/**
 * Animation presets through the one sampler, as pure functions.
 *
 * Every rule in `@shared/animation`'s header is checked by what the clip draws — its layout at
 * the head, the middle and the tail from `animatedItemAt`, the function the compositor paints —
 * rather than by the stored spec: glued to the ends through a trim, sharing a clip too short for
 * both, riding on keys instead of replacing them, set aside under a transition, divided by a
 * split. The same rules through the real tools are in `renderer/src/mcp/text-animation.test.ts`.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/shared/animation.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Item, Transition } from './project'
import { animatedItemAt, keyedItemAt } from './keyframes'
import { splitItemAt } from './split'
import {
  ANIMATION_KINDS,
  ANIMATION_PRESETS,
  LOOP_KINDS,
  animationCatalogText,
  animationForDraw,
  animationRevealAt,
  animationStateAt,
  animationWindows,
  describeAnimation,
  mergeAnimation,
  splitAnimation,
  textUnitsAt,
  unitProgress,
  type AnimationTarget,
  type ItemAnimation,
  type UnitPosition
} from './animation'

const FROM = 100
const LENGTH = 150

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'itm',
    assetId: 'ast',
    trackId: 'trk',
    from: FROM,
    durationInFrames: LENGTH,
    sourceStartUs: 0,
    layout: { left: 200, top: 100, width: 800, height: 400, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...over
  }
}

const drawn = (it: Item, local: number): Item => animatedItemAt(it, it.from + local)

// -- the fast path ------------------------------------------------------------------------------

test('a clip with no presets, and a clip between its In and its Out, is drawn as the very same object', () => {
  const plain = item()
  assert.equal(animatedItemAt(plain, FROM + 40), plain)
  const worn = item({ animation: { in: { kind: 'fade', frames: 20 }, out: { kind: 'slide', frames: 20 } } })
  assert.equal(drawn(worn, 20), worn, 'the first frame after the In')
  assert.equal(drawn(worn, 75), worn)
  assert.equal(drawn(worn, LENGTH - 20), worn, 'the last frame before the Out')
  // The positive control: inside either window it is not the same object.
  assert.notEqual(drawn(worn, 19), worn)
  assert.notEqual(drawn(worn, LENGTH - 19), worn)
})

// -- each kind, at the head, inside the window and at rest --------------------------------------------

test('fade: nothing at the head, rising through the window, and the tail mirrors it', () => {
  const it = item({ animation: { in: { kind: 'fade', frames: 20 }, out: { kind: 'fade', frames: 10 } } })
  assert.equal(drawn(it, 0).layout.opacity, 0)
  const series = Array.from({ length: 21 }, (_, f) => drawn(it, f).layout.opacity)
  for (let f = 1; f < series.length; f += 1) assert.ok(series[f]! > series[f - 1]!, `opacity must rise at frame ${f}`)
  assert.equal(series[20], 1)
  // Position and size are not a fade's business.
  assert.deepEqual({ ...drawn(it, 5).layout, opacity: 1 }, it.layout)
  const tail = Array.from({ length: 10 }, (_, k) => drawn(it, LENGTH - 10 + k).layout.opacity)
  for (let k = 1; k < tail.length; k += 1) assert.ok(tail[k]! < tail[k - 1]!, 'opacity must fall through the Out')
  assert.ok(tail[9]! > 0 && tail[9]! < 0.1, 'the last frame is nearly gone, as a fade-out\'s is')
})

test('slide: starts a quarter of its box away on the side named, and travels the right way on an Out', () => {
  const at = (from: 'left' | 'right' | 'top' | 'bottom' | undefined, local: number): { dx: number; dy: number } => {
    const it = item({ animation: { in: { kind: 'slide', frames: 20, ...(from ? { from } : {}) } } })
    const layout = drawn(it, local).layout
    return { dx: layout.left - 200, dy: layout.top - 100 }
  }
  assert.deepEqual(at(undefined, 0), { dx: -200, dy: 0 }, 'left is the default: a quarter of 800 to the left')
  assert.deepEqual(at('right', 0), { dx: 200, dy: 0 })
  assert.deepEqual(at('top', 0), { dx: 0, dy: -100 })
  assert.deepEqual(at('bottom', 0), { dx: 0, dy: 100 })
  const half = at('right', 10)
  assert.ok(half.dx > 0 && half.dx < 200 * 0.2, `most of the way home at the middle of a snappy curve, got ${half.dx}`)
  assert.deepEqual(at('right', 20), { dx: 0, dy: 0 })
  // An Out toward the right ends on the right.
  const leaving = item({ animation: { out: { kind: 'slide', frames: 20, from: 'right', amount: 0.5 } } })
  assert.equal(drawn(leaving, LENGTH - 21).layout.left, 200)
  assert.ok(drawn(leaving, LENGTH - 1).layout.left > 200 + 400 * 0.5, 'half a box to the right by the last frame, most of it done')
})

test('scale starts at its amount; pop overshoots and settles exactly; both multiply the clip\'s own zoom', () => {
  const scaled = item({ layout: { ...item().layout, scale: 1.5 }, animation: { in: { kind: 'scale', frames: 20 } } })
  assert.equal(drawn(scaled, 0).layout.scale, 1.5 * ANIMATION_PRESETS.scale.amount!.default)
  assert.equal(drawn(scaled, 20).layout.scale, 1.5)
  const popped = item({ animation: { in: { kind: 'pop', frames: 30 } } })
  const sizes = Array.from({ length: 31 }, (_, f) => drawn(popped, f).layout.scale ?? 1)
  assert.equal(sizes[0], 0)
  const peak = Math.max(...sizes)
  assert.ok(peak > 1.05 && peak < 1.3, `a pop goes a little past full size, got ${peak}`)
  assert.equal(sizes[30], 1)
  assert.ok(Math.abs(sizes[29]! - 1) < 0.02, `settled by the end of the window, got ${sizes[29]}`)
})

test('blur-in adds to the clip\'s own blur through its adjustments, and leaves the other adjustments alone', () => {
  const soft = item({ adjustments: { brightness: 1.2, contrast: 1, saturate: 1, hueRotate: 0, blur: 3, grayscale: 0, sepia: 0, invert: 0 }, animation: { in: { kind: 'blur', frames: 20 } } })
  assert.equal(drawn(soft, 0).adjustments?.blur, 3 + ANIMATION_PRESETS.blur.amount!.default)
  assert.equal(drawn(soft, 0).adjustments?.brightness, 1.2)
  assert.equal(drawn(soft, 20).adjustments?.blur, 3)
  // A clip with no adjustments gets the identity ones plus the blur — never a NaN in the filter.
  const bare = drawn(item({ animation: { in: { kind: 'blur', frames: 20, amount: 40 } } }), 0)
  assert.deepEqual(bare.adjustments, { brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, blur: 40, grayscale: 0, sepia: 0, invert: 0 })
})

test('wipe moves nothing: it hides the far side behind an edge that crosses the box', () => {
  const it = item({ animation: { in: { kind: 'wipe', frames: 20, from: 'top' } } })
  assert.deepEqual(drawn(it, 0).layout, it.layout)
  assert.deepEqual(animationRevealAt(it, FROM), { left: 0, right: 0, top: 0, bottom: 1 }, 'from the top: everything below the edge is hidden')
  assert.equal(animationRevealAt(it, FROM + 10)?.bottom, 0.5)
  assert.equal(animationRevealAt(it, FROM + 20), null)
  assert.deepEqual(animationRevealAt(item({ animation: { in: { kind: 'wipe', frames: 20 } } }), FROM), { left: 0, right: 1, top: 0, bottom: 0 })
})

test('rise starts one whole box below, under a mask the size of the box', () => {
  const it = item({ animation: { in: { kind: 'rise', frames: 20 } } })
  assert.equal(drawn(it, 0).layout.top, 100 + 400)
  assert.deepEqual(animationRevealAt(it, FROM), { left: 0, top: 0, right: 0, bottom: 0 })
  assert.equal(drawn(it, 0).layout.opacity, 1, 'it does not fade: the mask is what hides it')
  assert.equal(animationRevealAt(it, FROM + 20), null)
})

test('loops run the whole clip from rest, and repeat every cycle', () => {
  const it = item({ animation: { loop: { kind: 'pulse', frames: 40 } } })
  assert.equal(drawn(it, 0).layout.scale ?? 1, 1, 'a cycle starts where the clip rests, so nothing jumps')
  assert.ok(Math.abs((drawn(it, 10).layout.scale ?? 1) - 1.04) < 1e-9, 'a quarter cycle in, at its largest')
  assert.ok(Math.abs((drawn(it, 30).layout.scale ?? 1) - 0.96) < 1e-9)
  assert.ok(Math.abs((drawn(it, 50).layout.scale ?? 1) - (drawn(it, 10).layout.scale ?? 1)) < 1e-9)
  const swaying = item({ animation: { loop: { kind: 'sway', frames: 40, amount: 5 } } })
  assert.ok(Math.abs(drawn(swaying, 10).layout.rotation - 5) < 1e-9)
  const flicker = item({ animation: { loop: { kind: 'flicker', frames: 12 } } })
  for (let f = 0; f < 60; f += 1) {
    const opacity = drawn(flicker, f).layout.opacity
    assert.ok(opacity <= 1 && opacity >= 1 - 0.35 - 1e-9, `a flicker dips no further than its amount, got ${opacity}`)
  }
})

// -- glued to the ends ----------------------------------------------------------------------------

test('trimming the head leaves the In on the new first frames; trimming the tail leaves the Out on the new last', () => {
  const animation: ItemAnimation = { in: { kind: 'slide', frames: 20, from: 'bottom' }, out: { kind: 'fade', frames: 20 } }
  const whole = item({ animation })
  // A head trim of 30: the clip starts later and is shorter. Nothing about the preset is rewritten.
  const headTrimmed = item({ animation, from: FROM + 30, durationInFrames: LENGTH - 30 })
  for (const local of [0, 5, 19, 20]) {
    assert.deepEqual(drawn(headTrimmed, local).layout, drawn(whole, local).layout, `the In at its frame ${local}`)
  }
  // At the *timeline* frame the old head was on, the trimmed clip is not on screen at all, and
  // at its own head it is mid-slide — the In did not stay behind.
  assert.notDeepEqual(drawn(headTrimmed, 0).layout, headTrimmed.layout)
  const tailTrimmed = item({ animation, durationInFrames: LENGTH - 45 })
  for (const back of [1, 7, 20]) {
    assert.equal(drawn(tailTrimmed, tailTrimmed.durationInFrames - back).layout.opacity, drawn(whole, LENGTH - back).layout.opacity, `the Out ${back} from the end`)
  }
  assert.ok(drawn(tailTrimmed, tailTrimmed.durationInFrames - 1).layout.opacity < 0.1)
})

// -- shorter than its presets ---------------------------------------------------------------------

test('when In and Out are longer than the clip together they share it in proportion, and never overlap', () => {
  assert.deepEqual(animationWindows({ in: { kind: 'fade', frames: 30 }, out: { kind: 'fade', frames: 30 } }, 150), { inFrames: 30, outFrames: 30, shortened: false })
  assert.deepEqual(animationWindows({ in: { kind: 'fade', frames: 30 }, out: { kind: 'fade', frames: 30 } }, 40), { inFrames: 20, outFrames: 20, shortened: true })
  assert.deepEqual(animationWindows({ in: { kind: 'fade', frames: 30 }, out: { kind: 'fade', frames: 10 } }, 20), { inFrames: 15, outFrames: 5, shortened: true })
  // One alone is capped at the clip.
  assert.deepEqual(animationWindows({ in: { kind: 'fade', frames: 30 } }, 12), { inFrames: 12, outFrames: 0, shortened: true })
  // Exactly fitting is not shortened — the boundary's legal side.
  assert.deepEqual(animationWindows({ in: { kind: 'fade', frames: 25 }, out: { kind: 'fade', frames: 15 } }, 40), { inFrames: 25, outFrames: 15, shortened: false })

  // The requirement, over many shapes: the windows fill no more than the clip, and no frame is in both.
  let seed = 7
  const random = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return 1 + (seed % n)
  }
  for (let round = 0; round < 500; round += 1) {
    const length = random(60)
    const animation: ItemAnimation = { in: { kind: 'fade', frames: random(90) }, out: { kind: 'fade', frames: random(90) } }
    const { inFrames, outFrames } = animationWindows(animation, length)
    assert.ok(inFrames + outFrames <= length, `${inFrames} + ${outFrames} on a ${length}-frame clip`)
    assert.ok(inFrames >= 0 && outFrames >= 0)
    for (let local = 0; local < length; local += 1) {
      const inIn = local < inFrames
      const inOut = length - local < outFrames
      assert.ok(!(inIn && inOut), `frame ${local} of ${length} is in both windows`)
    }
  }
})

test('a clip too short for both still fades in and out, each over its share', () => {
  const short = item({ durationInFrames: 40, animation: { in: { kind: 'fade', frames: 30 }, out: { kind: 'fade', frames: 30 } } })
  assert.equal(drawn(short, 0).layout.opacity, 0)
  assert.equal(drawn(short, 20).layout.opacity, 1, 'full at the frame the two meet')
  assert.ok(drawn(short, 39).layout.opacity < 0.1)
  // Longer again, the stored lengths come back: nothing was rewritten.
  assert.equal(short.animation?.in?.frames, 30)
})

// -- over keys, not instead of them ---------------------------------------------------------------

test('a preset multiplies a keyed opacity and scale and adds to a keyed position: neither replaces the other', () => {
  const keyframes = {
    scale: [{ frame: 0, value: 1 }, { frame: 150, value: 2 }],
    opacity: [{ frame: 0, value: 0.5 }],
    left: [{ frame: 0, value: 0 }, { frame: 150, value: 300 }]
  }
  const keysOnly = item({ keyframes, layout: { ...item().layout, scale: 9 } })
  const both = item({
    keyframes,
    layout: { ...item().layout, scale: 9 },
    animation: { in: { kind: 'scale', frames: 30, amount: 0.5 }, out: { kind: 'slide', frames: 30, from: 'right', amount: 0.5 } }
  })
  for (const local of [0, 7, 15, 29]) {
    const keyed = keyedItemAt(keysOnly, FROM + local).layout
    const preset = animationStateAt(both.animation, local, LENGTH)
    const shown = drawn(both, local).layout
    assert.ok(Math.abs((shown.scale ?? 1) - (keyed.scale ?? 1) * preset.scale) < 1e-12, `scale at ${local}`)
    assert.ok(Math.abs(shown.opacity - 0.5 * preset.opacity) < 1e-12, `opacity at ${local}`)
    assert.equal(shown.left, keyed.left, 'a scale preset leaves the keyed position alone')
    assert.notEqual(shown.scale, keyed.scale, 'and the preset is really in play here')
  }
  // In the middle the keys draw alone, exactly as they would with no preset.
  assert.deepEqual(drawn(both, 75).layout, keyedItemAt(keysOnly, FROM + 75).layout)
  // The Out adds to the keyed X rather than restarting from the static one.
  const late = LENGTH - 5
  const keyedLeft = keyedItemAt(keysOnly, FROM + late).layout.left
  assert.ok(drawn(both, late).layout.left > keyedLeft, 'pushed right of where the keys have it')
  assert.ok(keyedLeft > 250, 'the specimen: the keys themselves have moved it well away from the static 200')
})

// -- a transition wins at its cut -----------------------------------------------------------------

test('a transition across an end sets that end\'s preset aside, and leaves the stored one alone', () => {
  const animation: ItemAnimation = { in: { kind: 'slide', frames: 20 }, out: { kind: 'fade', frames: 20 } }
  const a = item({ id: 'a', animation })
  const b = item({ id: 'b', from: FROM + LENGTH, animation })
  const transition: Transition = { id: 't', kind: 'cross-dissolve' as Transition['kind'], fromItemId: 'a', toItemId: 'b', durationInFrames: 20 }
  const timeline = { transitions: [transition] }
  assert.deepEqual(animationForDraw(timeline, a).animation, { in: animation.in }, 'a leaves by the transition, so its Out is set aside')
  assert.deepEqual(animationForDraw(timeline, b).animation, { out: animation.out }, 'b arrives by the transition, so its In is')
  assert.deepEqual(a.animation, animation, 'the stored animation is untouched')
  // Drawn before its own first frame, as a transition draws it, b is where it rests — not slid away.
  const early = animatedItemAt(animationForDraw(timeline, b), b.from - 5)
  assert.equal(early.layout.left, 200)
  assert.notEqual(animatedItemAt(b, b.from - 5).layout.left, 200, 'without the rule it would be off to the side')
  // No transition on it: the very same object, both presets intact.
  const c = item({ id: 'c', animation })
  assert.equal(animationForDraw(timeline, c), c)
  assert.equal(animationForDraw({ transitions: [] }, a), a)
  // A clip whose only preset is set aside has none to draw.
  const onlyIn = item({ id: 'b', animation: { in: animation.in! } })
  assert.equal('animation' in animationForDraw(timeline, onlyIn), false)
})

// -- splitting ----------------------------------------------------------------------------------

test('a split leaves the In on the left half, the Out on the right, and the Loop on both', () => {
  const animation: ItemAnimation = { in: { kind: 'pop', frames: 12 }, out: { kind: 'fade', frames: 9 }, loop: { kind: 'float', frames: 60 } }
  const [left, right] = splitAnimation(animation)
  assert.deepEqual(left, { in: animation.in, loop: animation.loop })
  assert.deepEqual(right, { out: animation.out, loop: animation.loop })
  assert.deepEqual(splitAnimation({ in: animation.in! }), [{ in: animation.in }, undefined])

  const whole = item({ animation: { in: animation.in!, out: animation.out! } })
  const original = JSON.parse(JSON.stringify(whole)) as Item
  const rightHalf = splitItemAt(whole, FROM + 60, 30, 'right')!
  assert.deepEqual(whole.animation, { in: animation.in })
  assert.deepEqual(rightHalf.animation, { out: animation.out })
  // What the pair draws at the two ends is what the whole drew; and the cut itself is not animated.
  assert.deepEqual(drawn(whole, 3).layout, drawn(original, 3).layout)
  assert.deepEqual(animatedItemAt(rightHalf, FROM + LENGTH - 2).layout, animatedItemAt(original, FROM + LENGTH - 2).layout)
  assert.equal(animatedItemAt(rightHalf, FROM + 60), rightHalf, 'the right half does not pop in at the cut')

  const inOnly = item({ animation: { in: animation.in! } })
  const tail = splitItemAt(inOnly, FROM + 60, 30, 'tail')!
  assert.equal('animation' in tail, false, 'no empty animation is left on the half with nothing')
})

// -- a title's units ------------------------------------------------------------------------------

const position = (index: number, count: number): UnitPosition => ({ line: 0, lines: 1, word: index, words: count, letter: index, letters: count })

test('a preset that runs by unit leaves the clip itself at rest and hands the units to the painter', () => {
  const it = item({ animation: { in: { kind: 'fade', frames: 20, by: 'word' } } })
  assert.equal(drawn(it, 5), it, 'the clip is not faded as a whole')
  assert.equal(textUnitsAt(it, FROM + 5)?.by, 'word')
  assert.equal(textUnitsAt(it, FROM + 20), null, 'after the window the painter draws whole lines again')
  assert.equal(textUnitsAt(item({ animation: { in: { kind: 'fade', frames: 20 } } }), FROM + 5), null, 'a whole-clip preset has no units')
})

test('units run in reading order, overlapping, from the first starting to the last arriving', () => {
  for (const count of [2, 5, 13]) {
    assert.equal(unitProgress(0, 0, count), 0)
    assert.equal(unitProgress(1, count - 1, count), 1)
    for (const t of [0.1, 0.35, 0.6, 0.9]) {
      for (let index = 1; index < count; index += 1) {
        assert.ok(unitProgress(t, index, count) <= unitProgress(t, index - 1, count), 'a later unit is never ahead of an earlier one')
      }
    }
    assert.ok(unitProgress(0.5, 0, count) > unitProgress(0.5, count - 1, count), 'and part-way through the first is ahead of the last')
  }
  assert.equal(unitProgress(0.4, 0, 1), 0.4, 'one unit is just the run')
})

test('typewriter: whole letters appear one after another across the window, and vanish from the end on an Out', () => {
  const typed = (it: Item, local: number, count: number): number[] => {
    const units = textUnitsAt(it, FROM + local)
    return units ? Array.from({ length: count }, (_, index) => units.state(position(index, count)).opacity) : Array.from({ length: count }, () => 1)
  }
  const it = item({ animation: { in: { kind: 'typewriter', frames: 10 } } })
  assert.deepEqual(typed(it, 0, 5), [0, 0, 0, 0, 0])
  assert.deepEqual(typed(it, 2, 5), [1, 0, 0, 0, 0])
  assert.deepEqual(typed(it, 5, 5), [1, 1, 0, 0, 0])
  assert.deepEqual(typed(it, 9, 5), [1, 1, 1, 1, 0])
  assert.deepEqual(typed(it, 10, 5), [1, 1, 1, 1, 1])
  assert.equal(textUnitsAt(it, FROM + 3)?.by, 'letter', 'a typewriter is by letter whatever was asked')
  const out = item({ animation: { out: { kind: 'fade', frames: 20, by: 'word' } } })
  const leaving = typed(out, LENGTH - 12, 4)
  assert.ok(leaving[0]! < leaving[3]!, `the first word goes first, got ${leaving.join(', ')}`)
})

test('a rise by word is masked while the word is moving and not once it has landed; the finest unit decides the split', () => {
  const it = item({ animation: { in: { kind: 'rise', frames: 20, by: 'word' }, loop: { kind: 'float', frames: 30, by: 'letter' } } })
  const units = textUnitsAt(it, FROM + 6)!
  assert.equal(units.by, 'letter', 'letters are finer than words')
  const first = units.state({ line: 0, lines: 1, word: 0, words: 4, letter: 0, letters: 16 })
  const last = units.state({ line: 0, lines: 1, word: 3, words: 4, letter: 15, letters: 16 })
  assert.equal(last.masked, true)
  assert.ok(last.dy > first.dy, 'the last word is still lower than the first')
  const landed = textUnitsAt(item({ animation: { in: { kind: 'rise', frames: 20, by: 'word' } } }), FROM + 19)!
  assert.equal(landed.state({ line: 0, lines: 1, word: 0, words: 4, letter: 0, letters: 16 }).masked, false)
})

test('a word waiting its turn to rise is not drawn at all, whatever a Loop by letter adds; the word rising is', () => {
  const it = item({ animation: { in: { kind: 'rise', frames: 20, by: 'word' }, loop: { kind: 'float', frames: 30, by: 'letter' } } })
  const units = textUnitsAt(it, FROM + 2)!
  // The specimen must hold a waiting word and a moving one, or neither half below says anything.
  const moving = units.state({ line: 0, lines: 1, word: 0, words: 4, letter: 1, letters: 16 })
  const waiting = units.state({ line: 0, lines: 1, word: 3, words: 4, letter: 15, letters: 16 })
  assert.ok(moving.dy < 1 && moving.dy > 0, `the first word must be on its way up at this frame (dy ${moving.dy})`)
  assert.equal(moving.opacity, 1)
  assert.equal(waiting.opacity, 0, 'a word that has not started is not on the page, not parked under the mask')
  // Leaving: the first word goes first, and once it is fully down it is gone too.
  const leaving = textUnitsAt(item({ animation: { out: { kind: 'rise', frames: 20, by: 'word' }, loop: { kind: 'float', frames: 30, by: 'letter' } } }), FROM + LENGTH - 1)!
  assert.equal(leaving.state({ line: 0, lines: 1, word: 0, words: 4, letter: 0, letters: 16 }).opacity, 0)
})

// -- writing: each refusal beside the nearest call that is accepted -------------------------------

const TITLE: AnimationTarget = { itemId: 'itm_title', durationInFrames: 150, fps: 30, hasPicture: true, isText: true }
const PICTURE: AnimationTarget = { ...TITLE, itemId: 'itm_clip', isText: false }

const refused = (given: unknown, target: AnimationTarget = PICTURE, current?: ItemAnimation): string => {
  const merged = mergeAnimation(current, given, target)
  assert.equal(merged.ok, false, `expected ${JSON.stringify(given)} to be refused`)
  return merged.ok ? '' : merged.error
}
const accepted = (given: unknown, target: AnimationTarget = PICTURE, current?: ItemAnimation): ItemAnimation | undefined => {
  const merged = mergeAnimation(current, given, target)
  if (!merged.ok) assert.fail(merged.error)
  return merged.animation
}

test('a length is frames or seconds at the timeline\'s rate, and each kind has its own when neither is given', () => {
  assert.deepEqual(accepted({ in: { kind: 'fade', seconds: 0.5 } }), { in: { kind: 'fade', frames: 15 } })
  assert.deepEqual(accepted({ in: { kind: 'fade', frames: 7 } }), { in: { kind: 'fade', frames: 7 } })
  assert.deepEqual(accepted({ in: { kind: 'fade' } }, { ...PICTURE, fps: 60 }), { in: { kind: 'fade', frames: Math.round(ANIMATION_PRESETS.fade.seconds * 60) } })
  assert.match(refused({ in: { kind: 'fade', frames: 7, seconds: 1 } }), /both frames and seconds; give one/)
  assert.match(refused({ in: { kind: 'fade', frames: 0 } }), /whole number of frames, at least 1.*Or give seconds/)
  assert.match(refused({ in: { kind: 'fade', duration: 12 } }), /no field "duration".*The length is `frames` or `seconds`/)
})

test('a kind that does not exist names the ones that do, and the word that was probably meant', () => {
  const error = refused({ in: { kind: 'zoom' } })
  for (const kind of ANIMATION_KINDS) assert.ok(error.includes(kind), `the refusal lists ${kind}`)
  assert.match(error, /A zoom is "scale"/)
  assert.deepEqual(accepted({ in: { kind: 'scale', frames: 10 } }), { in: { kind: 'scale', frames: 10 } })
  assert.match(refused({ loop: { kind: 'fade' } }), /must be one of pulse, float, sway, flicker/)
  assert.deepEqual(accepted({ loop: { kind: 'pulse', frames: 40 } }), { loop: { kind: 'pulse', frames: 40 } })
})

test('a side is where it comes from; a direction of travel is refused with the side it means', () => {
  assert.deepEqual(accepted({ in: { kind: 'slide', frames: 10, from: 'bottom' } }), { in: { kind: 'slide', frames: 10, from: 'bottom' } })
  assert.match(refused({ in: { kind: 'slide', from: 'up' } }), /one of left, right, top, bottom.*coming up means from: "bottom"/)
  assert.match(refused({ in: { kind: 'fade', from: 'left' } }), /from does not apply to "fade" — only slide and wipe have a side/)
  // The default side is stored as absence.
  assert.deepEqual(accepted({ in: { kind: 'wipe', frames: 10, from: 'left' } }), { in: { kind: 'wipe', frames: 10 } })
})

test('only a title animates by line, word or letter, and only a title can be typed', () => {
  assert.deepEqual(accepted({ in: { kind: 'rise', frames: 20, by: 'word' } }, TITLE), { in: { kind: 'rise', frames: 20, by: 'word' } })
  const notTitle = refused({ in: { kind: 'rise', frames: 20, by: 'word' } }, PICTURE)
  assert.match(notTitle, /itm_clip is not a title\. Leave by out to animate the whole clip/)
  assert.deepEqual(accepted({ in: { kind: 'typewriter', frames: 30 } }, TITLE), { in: { kind: 'typewriter', frames: 30 } })
  assert.match(refused({ in: { kind: 'typewriter' } }, PICTURE), /needs letters to type.*Use "wipe"/)
  assert.match(refused({ in: { kind: 'wipe', by: 'word' } }, TITLE), /does not apply to "wipe".*use kind: "rise" or "fade" with by: "word"/)
  // `by: "clip"` is the default said aloud, legal anywhere and not stored.
  assert.deepEqual(accepted({ in: { kind: 'fade', frames: 5, by: 'clip' } }, PICTURE), { in: { kind: 'fade', frames: 5 } })
})

test('an amount outside its range is refused with what it means for that kind; the default is not stored', () => {
  assert.match(refused({ in: { kind: 'slide', amount: 5 } }), /for "slide" it is distance as a fraction of the box.*from 0\.02 to 2 \(default 0\.25\)/)
  assert.deepEqual(accepted({ in: { kind: 'slide', frames: 10, amount: 1 } }), { in: { kind: 'slide', frames: 10, amount: 1 } })
  assert.deepEqual(accepted({ in: { kind: 'slide', frames: 10, amount: 0.25 } }), { in: { kind: 'slide', frames: 10 } })
  assert.match(refused({ in: { kind: 'fade', amount: 0.5 } }), /amount does not apply to "fade"/)
})

test('each end named is replaced whole, null removes one, and null for the lot removes them all', () => {
  const current: ItemAnimation = { in: { kind: 'slide', frames: 10, from: 'right', amount: 1 }, out: { kind: 'fade', frames: 8 } }
  assert.deepEqual(accepted({ in: { kind: 'fade', frames: 4 } }, PICTURE, current), { in: { kind: 'fade', frames: 4 }, out: current.out })
  assert.deepEqual(accepted({ in: null }, PICTURE, current), { out: current.out })
  assert.equal(accepted({ in: null, out: null }, PICTURE, current), undefined)
  assert.equal(accepted(null, PICTURE, current), undefined)
  assert.match(refused({ fade: { frames: 10 } }), /no field "fade"\. It is \{ in\?, out\?, loop\? \} — such as \{ in: \{ kind: "fade" \} \}/)
})

test('a clip with no picture is refused, with what to use for sound', () => {
  assert.match(refused({ in: { kind: 'fade' } }, { ...PICTURE, hasPicture: false }), /sound-only clip.*fadeInFrames\/fadeOutFrames, or keyframes\.volume/)
  assert.ok(accepted({ in: { kind: 'fade' } }, PICTURE))
})

test('presets longer than the clip are stored as asked, and the note says what will play', () => {
  const merged = mergeAnimation(undefined, { in: { kind: 'fade', frames: 30 }, out: { kind: 'fade', frames: 30 } }, { ...PICTURE, durationInFrames: 40 })
  assert.ok(merged.ok)
  if (!merged.ok) return
  assert.equal(merged.animation?.in?.frames, 30)
  assert.equal(merged.notes.length, 1)
  assert.match(merged.notes[0]!, /40 frames.*in 30 \+ out 30.*in 20 and out 20/)
  // The nearest clip that fits them gets no note.
  const fits = mergeAnimation(undefined, { in: { kind: 'fade', frames: 30 }, out: { kind: 'fade', frames: 30 } }, { ...PICTURE, durationInFrames: 60 })
  assert.deepEqual(fits.ok && fits.notes, [])
})

test('the description is in timeline frames, the ones each end actually occupies', () => {
  const it = item({ durationInFrames: 40, animation: { in: { kind: 'fade', frames: 30 }, out: { kind: 'slide', frames: 30 }, loop: { kind: 'pulse', frames: 36 } } })
  assert.deepEqual(describeAnimation(it), {
    in: { kind: 'fade', timelineFrames: [100, 120] },
    out: { kind: 'slide', timelineFrames: [120, 140] },
    loop: { kind: 'pulse', everyFrames: 36 },
    note: 'shortened to fit the clip; the stored lengths are longer'
  })
  assert.equal(describeAnimation(item()), undefined)
})

test('the catalog an agent reads names every kind there is', () => {
  const text = animationCatalogText()
  for (const kind of [...ANIMATION_KINDS, ...LOOP_KINDS]) assert.ok(text.includes(`"${kind}"`), `${kind} is in the catalog`)
})
