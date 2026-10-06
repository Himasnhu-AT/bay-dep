/**
 * The paint stack, its validation and the looks, as pure functions.
 *
 * Each assertion is from the requirement: a title using only the single colour, outline, shadow
 * and plate resolves to exactly the four things it always drew and is stored in exactly the keys
 * it always had; a stack nests, casts and reaches as far as its numbers say; a refusal names what
 * to send instead; and a look changes paint and weight and nothing else.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/shared/text-style.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultTextStyle, type TextStyle } from './project'
import {
  LOOK_REFERENCE_SIZE,
  MAX_TEXT_LAYERS,
  TEXT_LOOKS,
  TextStyleError,
  activeTextLook,
  applyTextLook,
  copyTextLook,
  findTextLook,
  mergeTextLayers,
  textExtents,
  textPaintOf,
  usesTextLayers
} from './text-style'

/**
 * A title's style as every build before the paint stack wrote it: twelve keys, in this order.
 * A literal, because the reader that must still load it is one this code cannot update.
 */
const LEGACY_ON_DISK =
  '{"fontFamily":"Georgia, serif","fontSize":72,"fontWeight":700,"italic":false,"color":"#FFEEDD",' +
  '"align":"left","verticalAlign":"bottom","lineHeight":1.1,"letterSpacing":2,' +
  '"stroke":{"color":"#000000","width":6},"shadow":{"color":"#00000080","blur":12,"offsetX":0,"offsetY":4},' +
  '"background":{"color":"#101010","padding":20,"radius":8}}'

const legacy = (): TextStyle => JSON.parse(LEGACY_ON_DISK) as TextStyle

const refused = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    assert.ok(error instanceof TextStyleError, `expected a TextStyleError, got ${String(error)}`)
    return error.message
  }
  return assert.fail('expected a refusal')
}

// -- what a style paints ------------------------------------------------------------------------

test('a plain title paints one solid fill and nothing else', () => {
  const paint = textPaintOf(defaultTextStyle())
  assert.deepEqual(paint, { plate: null, shadows: [], strokes: [], fills: [{ kind: 'solid', color: '#FFFFFF' }] })
  assert.equal(usesTextLayers(defaultTextStyle()), false)
})

test('the single outline, shadow and plate resolve to exactly what they always drew', () => {
  const paint = textPaintOf(legacy())
  // The outline's canvas width is its stored width, round-joined; the plate pads evenly, as one block.
  assert.deepEqual(paint.strokes, [{ color: '#000000', lineWidth: 6, join: 'round' }])
  assert.deepEqual(paint.shadows, [{ color: '#00000080', blur: 12, offsetX: 0, offsetY: 4 }])
  assert.deepEqual(paint.plate, { color: '#101010', paddingX: 20, paddingY: 20, radius: 8, perLine: false })
  assert.deepEqual(paint.fills, [{ kind: 'solid', color: '#FFEEDD' }])
})

test('further outlines wrap outside the first, and are listed widest first so they nest when drawn in order', () => {
  const paint = textPaintOf({ ...legacy(), stroke: { color: '#111111', width: 10 }, strokes: [{ color: '#FFFFFF', width: 8 }, { color: '#FF0000', width: 4, join: 'miter' }] })
  assert.deepEqual(
    paint.strokes.map((stroke) => [stroke.color, stroke.lineWidth, stroke.join]),
    [['#FF0000', 22, 'miter'], ['#FFFFFF', 18, 'round'], ['#111111', 10, 'round']]
  )
})

test('a glow is laid down `strength` times with no offset, behind the drop shadows', () => {
  const paint = textPaintOf({ ...legacy(), glow: { color: '#39E6FF', blur: 30, strength: 3 }, shadows: [{ color: '#FF00FF', blur: 0, offsetX: 5, offsetY: 5 }] })
  assert.deepEqual(paint.shadows.map((shadow) => shadow.color), ['#39E6FF', '#39E6FF', '#39E6FF', '#00000080', '#FF00FF'])
  assert.ok(paint.shadows.slice(0, 3).every((shadow) => shadow.offsetX === 0 && shadow.offsetY === 0 && shadow.blur === 30))
})

test('fills replace the colour when present; an empty stack is a hollow title, an absent one is the colour', () => {
  const gradient = { kind: 'linear' as const, angle: 90, stops: [{ at: 0, color: '#FFFFFF' }, { at: 1, color: '#000000' }] }
  assert.deepEqual(textPaintOf({ ...legacy(), fills: [gradient] }).fills, [gradient])
  assert.deepEqual(textPaintOf({ ...legacy(), fills: [] }).fills, [])
  assert.deepEqual(textPaintOf(legacy()).fills, [{ kind: 'solid', color: '#FFEEDD' }])
})

test('a layer with a value that is not a number is dropped, and the rest of the title still paints', () => {
  const broken: TextStyle = {
    ...legacy(),
    strokes: [{ color: '#FFFFFF', width: Number.NaN }, { color: '#00FF00', width: 4 }],
    shadows: [{ color: '#000000', blur: Number.NaN, offsetX: 0, offsetY: 0 }],
    fills: [{ kind: 'linear', angle: Number.NaN, stops: [{ at: 0, color: '#FFFFFF' }, { at: 1, color: '#000000' }] }, { kind: 'solid', color: '#ABCDEF' }]
  }
  const paint = textPaintOf(broken)
  assert.deepEqual(paint.strokes.map((stroke) => stroke.lineWidth), [10, 6], 'the NaN outline adds no width')
  assert.equal(paint.shadows.length, 1, 'only the single shadow is left')
  assert.deepEqual(paint.fills, [{ kind: 'solid', color: '#ABCDEF' }])
})

test('the plate options change its shape and padding, and mean nothing without a plate', () => {
  const paint = textPaintOf({ ...legacy(), plate: { perLine: true, paddingX: 30, paddingY: 4 } })
  assert.deepEqual(paint.plate, { color: '#101010', paddingX: 30, paddingY: 4, radius: 8, perLine: true })
  assert.equal(textPaintOf({ ...legacy(), background: null, plate: { perLine: true } }).plate, null)
})

// -- how far the paint reaches ------------------------------------------------------------------

test('the paint reaches half the widest outline past the letters, and a shadow its blur and offset beyond that', () => {
  assert.deepEqual(textExtents(textPaintOf(defaultTextStyle())), { left: 0, top: 0, right: 0, bottom: 0 })
  const outlined = textPaintOf({ ...defaultTextStyle(), stroke: { color: '#000000', width: 12 } })
  assert.deepEqual(textExtents(outlined), { left: 6, top: 6, right: 6, bottom: 6 })
  const shadowed = textPaintOf({ ...defaultTextStyle(), stroke: { color: '#000000', width: 12 }, shadow: { color: '#000000', blur: 10, offsetX: 4, offsetY: 8 } })
  // Away from the offset it still reaches the outline; toward it, outline + blur + offset.
  assert.deepEqual(textExtents(shadowed), { left: 12, top: 8, right: 20, bottom: 24 })
  const lifted = textPaintOf({ ...defaultTextStyle(), fills: [{ kind: 'solid', color: '#000000', offsetX: 6, offsetY: 8 }, { kind: 'solid', color: '#FFFFFF' }] })
  assert.deepEqual(textExtents(lifted), { left: 0, top: 0, right: 6, bottom: 8 })
})

// -- validation: each refusal beside the nearest call that is accepted -----------------------------

test('a fill stack is checked layer by layer, and the refusal says what a fill is', () => {
  const base = defaultTextStyle()
  const ok = mergeTextLayers(base, { fills: [{ kind: 'solid', color: '#ffcc00' }, { kind: 'linear', angle: 45, stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000000' }] }] })
  assert.deepEqual(ok.fills, [
    { kind: 'solid', color: '#FFCC00' },
    { kind: 'linear', angle: 45, stops: [{ at: 0, color: '#FFF' }, { at: 1, color: '#000000' }] }
  ])
  const kind = refused(() => mergeTextLayers(base, { fills: [{ kind: 'gradient', color: '#FFCC00' }] }))
  assert.match(kind, /"text\.fills"\[0\]\.kind must be "solid", "linear" or "radial"/)
  assert.match(kind, /stops: \[\{ at, color \}/, 'the refusal shows the shape to send')
  assert.match(refused(() => mergeTextLayers(base, { fills: [{ kind: 'solid', color: 'red' }] })), /hex colour such as "#FFFFFF"/)
  const order = refused(() => mergeTextLayers(base, { fills: [{ kind: 'linear', angle: 0, stops: [{ at: 0.8, color: '#FFFFFF' }, { at: 0.2, color: '#000000' }] }] }))
  assert.match(order, /stops\[1\]\.at is 0\.2, before the stop ahead of it \(0\.8\)/)
  assert.match(refused(() => mergeTextLayers(base, { fills: [{ kind: 'linear', angle: 0, stops: [{ at: 0, color: '#FFFFFF' }] }] })), /2 to 8 stops/)
})

test('more layers than the limit are refused by count; the limit itself is accepted', () => {
  const stroke = { color: '#FFFFFF', width: 2 }
  const atLimit = mergeTextLayers(defaultTextStyle(), { strokes: Array.from({ length: MAX_TEXT_LAYERS }, () => stroke) })
  assert.equal(atLimit.strokes?.length, MAX_TEXT_LAYERS)
  const over = refused(() => mergeTextLayers(defaultTextStyle(), { strokes: Array.from({ length: MAX_TEXT_LAYERS + 1 }, () => stroke) }))
  assert.match(over, new RegExp(`has ${MAX_TEXT_LAYERS + 1} layers; the most is ${MAX_TEXT_LAYERS}`))
})

test('plate options need a plate, and say how to send one', () => {
  const none = refused(() => mergeTextLayers(defaultTextStyle(), { plate: { perLine: true } }))
  assert.match(none, /this title has none/)
  assert.match(none, /background: \{ color:/)
  const withPlate = mergeTextLayers({ ...defaultTextStyle(), background: { color: '#000000', padding: 10, radius: 0 } }, { plate: { perLine: true, paddingX: 24 } })
  assert.deepEqual(withPlate.plate, { perLine: true, paddingX: 24 })
})

test('null removes a layer field, and a value that is only the default is not stored', () => {
  const full = mergeTextLayers(
    { ...defaultTextStyle(), background: { color: '#000000', padding: 10, radius: 0 } },
    { fills: [], strokes: [{ color: '#FFFFFF', width: 4 }], shadows: [{ color: '#000000', blur: 4 }], glow: { color: '#FF00FF', blur: 20, strength: 1 }, plate: { perLine: true } }
  )
  assert.deepEqual(full.fills, [], 'an empty fill stack is kept: it is how hollow is said')
  assert.deepEqual(full.shadows, [{ color: '#000000', blur: 4, offsetX: 0, offsetY: 0 }])
  assert.deepEqual(full.glow, { color: '#FF00FF', blur: 20 }, 'strength 1 is the default and is stored as absence')
  const cleared = mergeTextLayers(full, { fills: null, strokes: [], shadows: null, glow: null, plate: null })
  assert.equal(usesTextLayers(cleared), false)
  assert.deepEqual(Object.keys(cleared), Object.keys({ ...defaultTextStyle() }))
})

test('an unknown field in a layer is named with the ones that exist', () => {
  assert.match(refused(() => mergeTextLayers(defaultTextStyle(), { glow: { color: '#FFFFFF', blur: 10, radius: 4 } })), /"text\.glow" has no field "radius"\. It accepts color, blur, strength/)
  assert.match(refused(() => mergeTextLayers(defaultTextStyle(), { strokes: [{ color: '#FFFFFF', width: 4, join: 'sharp' }] })), /join must be one of round, miter, bevel/)
})

// -- the stored form ----------------------------------------------------------------------------

test('a title that uses only the single fields is stored in the same twelve keys, byte for byte', () => {
  // Through the stack's merge with nothing to merge: no key may appear, move or change.
  assert.equal(JSON.stringify(mergeTextLayers(legacy(), {})), LEGACY_ON_DISK)
  // And a look that needs only the single fields writes only them, in the order they were in.
  const titled = applyTextLook(legacy(), findTextLook('title')!)
  assert.deepEqual(Object.keys(titled), Object.keys(legacy()))
  assert.equal(usesTextLayers(titled), false)
  // The positive control: a look that does need the stack adds keys, so the check above can fail.
  assert.equal(usesTextLayers(applyTextLook(legacy(), findTextLook('neon')!)), true)
})

// -- looks ----------------------------------------------------------------------------------------

test('there are at least twelve looks, each with its own id, and every one is legal by the tool\'s own rules', () => {
  assert.ok(TEXT_LOOKS.length >= 12, `${TEXT_LOOKS.length} looks`)
  assert.equal(new Set(TEXT_LOOKS.map((look) => look.id)).size, TEXT_LOOKS.length)
  for (const look of TEXT_LOOKS) {
    const base = { ...defaultTextStyle(), background: look.style.background ?? null }
    const { fills, strokes, shadows, glow, plate } = look.style
    const layers = Object.fromEntries(Object.entries({ fills, strokes, shadows, glow, plate }).filter(([, value]) => value !== undefined))
    assert.doesNotThrow(() => mergeTextLayers(base, layers), `${look.id} would be refused if an agent sent it`)
  }
})

test('a look changes paint and weight, and keeps the title\'s font, size, alignment and line height', () => {
  for (const look of TEXT_LOOKS) {
    const worn = applyTextLook(legacy(), look)
    for (const kept of ['fontFamily', 'fontSize', 'align', 'verticalAlign', 'lineHeight'] as const) {
      assert.equal(worn[kept], legacy()[kept], `${look.id} changed ${kept}`)
    }
    assert.notEqual(JSON.stringify(worn), LEGACY_ON_DISK, `${look.id} changed nothing`)
  }
})

test('a look\'s lengths are drawn for 96px type and scale to the title\'s own size', () => {
  const look = findTextLook('caption-bold')!
  const at = (fontSize: number): TextStyle => applyTextLook({ ...defaultTextStyle(), fontSize }, look)
  const reference = look.style.stroke!.width
  assert.equal(at(LOOK_REFERENCE_SIZE).stroke?.width, reference)
  assert.equal(at(LOOK_REFERENCE_SIZE / 2).stroke?.width, reference / 2)
  assert.equal(at(LOOK_REFERENCE_SIZE * 2).shadow?.offsetY, look.style.shadow!.offsetY * 2)
})

test('wearing a second look removes everything the first one set', () => {
  const neon = applyTextLook(defaultTextStyle(), findTextLook('neon')!)
  assert.ok(neon.glow && neon.fills)
  const title = applyTextLook(neon, findTextLook('title')!)
  assert.equal(usesTextLayers(title), false)
  assert.equal(title.stroke, null)
  assert.deepEqual(title, applyTextLook(defaultTextStyle(), findTextLook('title')!), 'the same as wearing it from plain')
})

test('the look a title is wearing is recognised at any size, and a title wearing none is not', () => {
  for (const size of [40, 96, 133]) {
    for (const look of TEXT_LOOKS) {
      assert.equal(activeTextLook(applyTextLook({ ...defaultTextStyle(), fontSize: size }, look))?.id, look.id, `${look.id} at ${size}px`)
    }
  }
  assert.equal(activeTextLook(legacy()), undefined)
})

test('copying a look from another title takes its paint and font, and keeps this one\'s size and place', () => {
  const source: TextStyle = { ...applyTextLook({ ...defaultTextStyle(), fontSize: 96 }, findTextLook('double-outline')!), fontFamily: 'Futura, sans-serif' }
  const target: TextStyle = { ...legacy(), fontSize: 48 }
  const copied = copyTextLook(target, source)
  assert.equal(copied.fontFamily, 'Futura, sans-serif')
  assert.equal(copied.color, source.color)
  assert.equal(copied.fontSize, 48)
  assert.equal(copied.align, 'left')
  assert.equal(copied.verticalAlign, 'bottom')
  // Half the size, half the outline.
  assert.equal(copied.stroke!.width, source.stroke!.width / 2)
  assert.equal(copied.strokes![0]!.width, source.strokes![0]!.width / 2)
  assert.equal(copied.background, null, 'the source has no plate, so the copy has none')
})
