/**
 * The keyable properties as a table, and the seam for path families.
 *
 * Checked by what the clip draws: a key on a crop edge, an adjustment or a title's size must
 * arrive in the field the compositor reads for it, through the one sampler; the rules that keep
 * keys on their footage must carry every key a clip has, including one this build cannot draw;
 * and a registered path family must be validated, sampled and maintained with no further change.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/shared/keyframe-registry.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEYFRAME_PROPERTIES, defaultTextStyle, type Item, type ItemKeyframes, type Keyframe, type KeyframeProperty } from './project'
import { animatedItemAt, cloneKeyframes, describeKeyframes, mergeKeyframes, shiftKeyframes, sliceKeyframes, type KeyframeTarget } from './keyframes'
import { DYNAMIC_KEYFRAME_PATHS, KEYFRAME_REGISTRY, keyframeInfo, propertiesIn, type DynamicKeyframePath } from './keyframe-registry'

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'itm',
    assetId: 'ast',
    trackId: 'trk',
    from: 100,
    durationInFrames: 100,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...over
  }
}

const ramp = (from: number, to: number): Keyframe[] => [{ frame: 0, value: from }, { frame: 100, value: to }]
const TARGET: KeyframeTarget = { itemId: 'itm', from: 100, durationInFrames: 100, hasPicture: true, hasAudio: true, isText: false, hasSource: true }

/** The field the compositor reads for each property, read off the drawn item — not through the registry. */
function drawnValue(shown: Item, property: KeyframeProperty): number | undefined {
  switch (property) {
    case 'cropLeft': return shown.crop?.left
    case 'cropTop': return shown.crop?.top
    case 'cropRight': return shown.crop?.right
    case 'cropBottom': return shown.crop?.bottom
    case 'fontSize': return shown.text?.fontSize
    case 'letterSpacing': return shown.text?.letterSpacing
    case 'scale': return shown.layout.scale
    case 'volume': return undefined
    case 'opacity': case 'left': case 'top': case 'width': case 'height': case 'rotation': return shown.layout[property]
    default: return shown.adjustments?.[property]
  }
}

test('every animatable property has a row, a label of its own and a range', () => {
  assert.deepEqual(Object.keys(KEYFRAME_REGISTRY).sort(), [...KEYFRAME_PROPERTIES].sort())
  const labels = KEYFRAME_PROPERTIES.map((property) => KEYFRAME_REGISTRY[property].label)
  assert.equal(new Set(labels).size, labels.length, 'two properties with one name could not be told apart in the inspector')
  for (const property of KEYFRAME_PROPERTIES) assert.ok(KEYFRAME_REGISTRY[property].min < KEYFRAME_REGISTRY[property].max, property)
  assert.deepEqual(propertiesIn('crop'), ['cropLeft', 'cropTop', 'cropRight', 'cropBottom'])
  assert.deepEqual(propertiesIn('text'), ['fontSize', 'letterSpacing'])
})

test('a key on any picture property arrives in the field the compositor draws from, half way between its keys', () => {
  for (const property of KEYFRAME_PROPERTIES) {
    // Not pictures: volume is sound, and speed (a `planned` row) decides which source is read —
    // `sourceEdgeAt` integrates it, and `speed-curve.test.ts` holds that.
    if (property === 'volume' || KEYFRAME_REGISTRY[property].planned) continue
    const info = KEYFRAME_REGISTRY[property]
    // Two legal values inside the range, different from the static one, so a sampler that
    // returned the stored field would be caught.
    const lo = Number.isFinite(info.min) ? info.min : 10
    const from = Math.max(lo, 0.1) + (info.max > 1 ? 2 : 0)
    const to = Math.min(info.max, info.max > 1 ? from + 20 : 0.4)
    const it = item({ text: defaultTextStyle(), keyframes: { [property]: ramp(from, to) } })
    assert.notEqual(info.read(it), (from + to) / 2, `${property}: the specimen must differ from the static value`)
    const shown = animatedItemAt(it, 150)
    assert.ok(Math.abs((drawnValue(shown, property) ?? NaN) - (from + to) / 2) < 1e-9, `${property} drew ${drawnValue(shown, property)}, expected ${(from + to) / 2}`)
    assert.notEqual(shown, it)
  }
})

test('a key on one group leaves the others as the very objects they were', () => {
  const it = item({ crop: { left: 0.1, top: 0, right: 0, bottom: 0 }, keyframes: { blur: ramp(0, 20) } })
  const shown = animatedItemAt(it, 150)
  assert.equal(shown.layout, it.layout)
  assert.equal(shown.crop, it.crop)
  assert.equal(shown.adjustments?.blur, 10)
  assert.equal(shown.adjustments?.brightness, 1, 'an unset adjustment reads as its identity, never undefined in the filter')
})

test('two keyed crop edges can never take the whole picture between them', () => {
  const it = item({ keyframes: { cropLeft: [{ frame: 0, value: 0.9 }], cropRight: [{ frame: 0, value: 0.9 }] } })
  const crop = animatedItemAt(it, 120).crop!
  assert.ok(crop.left + crop.right < 1, `left ${crop.left} + right ${crop.right} must leave something`)
})

test('a title with no style of its own has nowhere to put a keyed size, and is drawn as it is', () => {
  const unstyled = item({ keyframes: { fontSize: ramp(40, 80) } })
  assert.equal(animatedItemAt(unstyled, 150).text, undefined)
  const styled = item({ text: defaultTextStyle(), keyframes: { fontSize: ramp(40, 80) } })
  assert.equal(animatedItemAt(styled, 150).text?.fontSize, 60)
  assert.equal(animatedItemAt(styled, 150).text?.color, styled.text?.color)
})

test('one key that is not a number is skipped, and the other keyed properties still draw', () => {
  const it = item({ keyframes: { blur: [{ frame: 0, value: Number.NaN }], contrast: [{ frame: 0, value: 1.5 }] } })
  const shown = animatedItemAt(it, 150)
  assert.equal(shown.adjustments?.blur, 0)
  assert.equal(shown.adjustments?.contrast, 1.5)
})

// -- writing ------------------------------------------------------------------------------------

test('a property is refused on a clip that has nothing for it to change, and accepted on one that does', () => {
  const size = { fontSize: ramp(40, 80) }
  const onVideo = mergeKeyframes(undefined, size, TARGET)
  assert.equal(onVideo.ok, false)
  assert.match(onVideo.ok ? '' : onVideo.error, /not a title.*key scale instead/)
  assert.equal(mergeKeyframes(undefined, size, { ...TARGET, isText: true, hasSource: false }).ok, true)

  const crop = { cropLeft: ramp(0, 0.3) }
  const onTitle = mergeKeyframes(undefined, crop, { ...TARGET, isText: true, hasSource: false })
  assert.equal(onTitle.ok, false)
  assert.match(onTitle.ok ? '' : onTitle.error, /a crop cuts a source picture.*kind: "wipe"/)
  assert.equal(mergeKeyframes(undefined, crop, TARGET).ok, true)

  const adjust = { saturate: ramp(1, 0) }
  const onSound = mergeKeyframes(undefined, adjust, { ...TARGET, hasPicture: false })
  assert.equal(onSound.ok, false)
  assert.match(onSound.ok ? '' : onSound.error, /sound-only clip/)
  assert.equal(mergeKeyframes(undefined, adjust, TARGET).ok, true)
})

test('a value outside a property\'s range names the range, and the names an agent guesses are corrected', () => {
  const over = mergeKeyframes(undefined, { cropLeft: [{ frame: 0, value: 30 }] }, TARGET)
  assert.match(over.ok ? '' : over.error, /keyframes\.cropLeft\[0\]\.value is 30, outside cropLeft's range 0\.\.1/)
  assert.equal(mergeKeyframes(undefined, { cropLeft: [{ frame: 0, value: 0.3 }] }, TARGET).ok, true)
  const crop = mergeKeyframes(undefined, { crop: [{ frame: 0, value: 0.3 }] }, TARGET)
  assert.match(crop.ok ? '' : crop.error, /no property "crop".*keyed per edge: cropLeft, cropTop, cropRight, cropBottom\.$/)
  const saturation = mergeKeyframes(undefined, { saturation: [{ frame: 0, value: 1 }] }, TARGET)
  assert.match(saturation.ok ? '' : saturation.error, /saturation is saturate\.$/)
  const zoom = mergeKeyframes(undefined, { zoom: [{ frame: 0, value: 1 }] }, TARGET)
  assert.match(zoom.ok ? '' : zoom.error, /a zoom is scale\.$/)
})

// -- the edit rules carry every key ---------------------------------------------------------------

test('trims, splits and copies carry a key this build cannot draw, instead of dropping it', () => {
  const future = { blur: ramp(0, 20), 'effect.fx_9.amount': ramp(0, 1) } as unknown as ItemKeyframes
  const read = (keys: ItemKeyframes | undefined, name: string): Keyframe[] | undefined => (keys as Record<string, Keyframe[]> | undefined)?.[name]
  assert.deepEqual(read(cloneKeyframes(future), 'effect.fx_9.amount'), ramp(0, 1))
  assert.deepEqual(read(shiftKeyframes(future, -10), 'effect.fx_9.amount')?.map((key) => key.frame), [-10, 90])
  assert.deepEqual(read(sliceKeyframes(future, 40, 100), 'effect.fx_9.amount')?.map((key) => key.frame), [-40, 60])
  assert.ok(describeKeyframes(item({ keyframes: future }))?.['effect.fx_9.amount'])
  // Unknown to the sampler, so it draws nothing with it — and must not throw.
  assert.equal(animatedItemAt(item({ keyframes: future }), 150).adjustments?.blur, 10)
})

test('a split divides a keyed blur exactly: each half draws what the whole did', () => {
  const keys: ItemKeyframes = { blur: [{ frame: 0, value: 0, ease: 'inOut' }, { frame: 30, value: 12 }, { frame: 100, value: 4 }] }
  const whole = item({ keyframes: keys })
  const left = item({ durationInFrames: 45, keyframes: sliceKeyframes(keys, 0, 45) })
  const right = item({ from: 145, durationInFrames: 55, keyframes: sliceKeyframes(keys, 45, 100) })
  for (let frame = 100; frame < 200; frame += 1) {
    const half = frame < 145 ? left : right
    assert.equal(animatedItemAt(half, frame).adjustments?.blur, animatedItemAt(whole, frame).adjustments?.blur, `frame ${frame}`)
  }
})

// -- the seam -----------------------------------------------------------------------------------

test('a registered path family is validated, sampled and described with no change to the sampler', () => {
  // A stand-in for an effect stack: `effect.<id>.amount` writes a number the test can read back.
  const family: DynamicKeyframePath = {
    prefix: 'effect.',
    describe: (it, path) =>
      path === `effect.${it.id}.amount` ? { label: 'Glow amount', min: 0, max: 1, unit: '0 off to 1 full' } : { error: `${path}: this clip has no such effect. Its effects: ${it.id}.` },
    apply: (it, _path, value) => ({ ...it, variables: { ...it.variables, amount: value } })
  }
  DYNAMIC_KEYFRAME_PATHS.push(family)
  try {
    const it = item()
    const path = 'effect.itm.amount'
    const merged = mergeKeyframes(undefined, { [path]: ramp(0, 1) }, { ...TARGET, item: it })
    assert.equal(merged.ok, true, merged.ok ? '' : merged.error)
    if (!merged.ok) return
    const animated = item({ keyframes: merged.keyframes })
    assert.equal(animatedItemAt(animated, 125).variables?.amount, 0.25)
    assert.equal(animatedItemAt(animated, 125).layout, animated.layout)
    assert.deepEqual(keyframeInfo(it, path) && 'label' in keyframeInfo(it, path) && (keyframeInfo(it, path) as { label: string }).label, 'Glow amount')
    // Its own range and its own refusal are used, not a static row's.
    const over = mergeKeyframes(undefined, { [path]: [{ frame: 0, value: 4 }] }, { ...TARGET, item: it })
    assert.match(over.ok ? '' : over.error, /outside effect\.itm\.amount's range 0\.\.1 \(0 off to 1 full\)/)
    const missing = mergeKeyframes(undefined, { 'effect.gone.amount': ramp(0, 1) }, { ...TARGET, item: it })
    assert.match(missing.ok ? '' : missing.error, /this clip has no such effect\. Its effects: itm/)
  } finally {
    DYNAMIC_KEYFRAME_PATHS.splice(DYNAMIC_KEYFRAME_PATHS.indexOf(family), 1)
  }
  // With nothing registered the same name is simply not animatable — the seam is closed by default.
  assert.equal(DYNAMIC_KEYFRAME_PATHS.length, 0)
  const closed = mergeKeyframes(undefined, { 'effect.itm.amount': ramp(0, 1) }, { ...TARGET, item: item() })
  assert.match(closed.ok ? '' : closed.error, /no property "effect\.itm\.amount"/)
})
