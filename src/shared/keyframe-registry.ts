/**
 * What can be keyframed, as one table: for each property its name in the inspector, its legal
 * range, what kind of clip has it, and how it reads from and writes to an item.
 *
 * The sampler (`animatedItemAt`), the validator (`mergeKeyframes`), the inspector's diamonds and
 * the graph all read this, so adding a property is adding a row — and the rules that keep keys on
 * their footage through a trim, split or ripple (`sliceKeyframes`, `shiftKeyframes`) already walk
 * every key a clip has, so a new row needs nothing from them.
 *
 * ## The seam for effect and mask parameters
 *
 * Properties whose names are only known per clip — parameter `amount` of the effect with id
 * `fx_3`, the feather of mask `m_1` — cannot be rows of a constant table. They register a
 * **path family** instead ({@link DYNAMIC_KEYFRAME_PATHS}): a prefix, and two functions.
 *
 *     DYNAMIC_KEYFRAME_PATHS.push({
 *       prefix: 'effect.',                          // keys are stored as `effect.<id>.<param>`
 *       describe: (item, path) => …,                // its label and range on this item, or why not
 *       apply: (item, path, value) => …             // a copy of the item drawing with that value
 *     })
 *
 * A key list stored under `effect.fx_3.amount` is then validated by `mergeKeyframes`, sampled by
 * `animatedItemAt`, carried through every edit, listed in the inspector and drawn in the graph,
 * with no further change here. `apply` must return a new item and must not throw: a path whose
 * effect was deleted describes as an error and is skipped at draw time, never fatal. The table is
 * empty in this build — nothing registers until the effect stack and the shape masks land.
 */

import { KEYFRAME_PROPERTIES, NO_CROP, adjustmentsOf, normaliseCrop, type Adjustments, type Crop, type Item, type KeyframeProperty } from './project'

export type KeyframeGroup = 'transform' | 'crop' | 'adjustments' | 'text' | 'audio' | 'time'

/** What a clip must be for a property to do anything on it. */
export type KeyframeNeeds = 'picture' | 'source' | 'text' | 'audio'

export interface KeyframeRange {
  min: number
  max: number
  /** The unit, as said in a refusal. */
  unit: string
}

export interface KeyframePropertyInfo extends KeyframeRange {
  /** How the inspector names it. */
  label: string
  group: KeyframeGroup
  needs: KeyframeNeeds
  /** The static value on `item` — what the property is with no keys. */
  read(item: Item): number
  /** How a value is shown beside a key. */
  format(value: number): string
  /**
   * Set on a property that is never written as a bare key, with the sentence that says where it
   * is written instead. `speed` is the one: a speed key changes how much footage the clip reads,
   * so the clip's length has to be re-planned with it (`planRetime` in `@shared/speed`). Such a
   * row is in the table so that its keys are validated on load, shifted and sliced like any
   * other; it is left out of {@link WRITABLE_KEYFRAME_PROPERTIES}, which is what the Animate
   * picker, the graph, the diamonds and `mergeKeyframes` offer.
   */
  planned?: string
}

const px = (value: number): string => `${Math.round(value)}px`
const percent = (value: number): string => `${Math.round(value * 100)}%`
const degrees = (value: number): string => `${Number(value.toFixed(1))}°`
const times = (value: number): string => `${Number(value.toFixed(2))}×`

function layoutRow(
  label: string,
  key: 'opacity' | 'left' | 'top' | 'width' | 'height' | 'rotation',
  range: KeyframeRange,
  format: (value: number) => string
): KeyframePropertyInfo {
  return { label, group: 'transform', needs: 'picture', ...range, read: (item) => item.layout[key], format }
}

function cropRow(label: string, edge: keyof Crop): KeyframePropertyInfo {
  return {
    label,
    group: 'crop',
    needs: 'source',
    min: 0,
    max: 1,
    unit: 'a fraction of the source cut from that edge, 0 none',
    read: (item) => (item.crop ?? NO_CROP)[edge],
    format: percent
  }
}

function adjustRow(label: string, key: keyof Adjustments, range: KeyframeRange, format: (value: number) => string): KeyframePropertyInfo {
  return { label, group: 'adjustments', needs: 'picture', ...range, read: (item) => adjustmentsOf(item.adjustments)[key], format }
}

export const KEYFRAME_REGISTRY: Record<KeyframeProperty, KeyframePropertyInfo> = {
  opacity: layoutRow('Opacity', 'opacity', { min: 0, max: 1, unit: '0 transparent to 1 opaque' }, percent),
  left: layoutRow('X', 'left', { min: -Infinity, max: Infinity, unit: 'canvas pixels' }, px),
  top: layoutRow('Y', 'top', { min: -Infinity, max: Infinity, unit: 'canvas pixels' }, px),
  width: layoutRow('Width', 'width', { min: 1, max: Infinity, unit: 'canvas pixels, at least 1' }, px),
  height: layoutRow('Height', 'height', { min: 1, max: Infinity, unit: 'canvas pixels, at least 1' }, px),
  rotation: layoutRow('Rotation', 'rotation', { min: -Infinity, max: Infinity, unit: 'degrees clockwise' }, degrees),
  scale: {
    label: 'Scale',
    group: 'transform',
    needs: 'picture',
    min: 0,
    max: 100,
    unit: 'a zoom about the centre, 1 unchanged',
    read: (item) => item.layout.scale ?? 1,
    format: percent
  },
  volume: {
    label: 'Volume',
    group: 'audio',
    needs: 'audio',
    min: 0,
    max: 2,
    unit: 'linear gain, 1 unchanged, 0 silent (or pass db instead of value)',
    read: (item) => item.volume,
    format: times
  },
  cropLeft: cropRow('Crop left', 'left'),
  cropTop: cropRow('Crop top', 'top'),
  cropRight: cropRow('Crop right', 'right'),
  cropBottom: cropRow('Crop bottom', 'bottom'),
  brightness: adjustRow('Brightness', 'brightness', { min: 0, max: 10, unit: '1 unchanged' }, times),
  contrast: adjustRow('Contrast', 'contrast', { min: 0, max: 10, unit: '1 unchanged' }, times),
  saturate: adjustRow('Saturation', 'saturate', { min: 0, max: 10, unit: '1 unchanged, 0 grey' }, times),
  hueRotate: adjustRow('Hue', 'hueRotate', { min: -3600, max: 3600, unit: 'degrees, 0 unchanged' }, degrees),
  blur: adjustRow('Blur', 'blur', { min: 0, max: 400, unit: 'canvas pixels, 0 off' }, px),
  grayscale: adjustRow('Greyscale', 'grayscale', { min: 0, max: 1, unit: '0 none to 1 full' }, percent),
  sepia: adjustRow('Sepia', 'sepia', { min: 0, max: 1, unit: '0 none to 1 full' }, percent),
  invert: adjustRow('Invert', 'invert', { min: 0, max: 1, unit: '0 none to 1 full' }, percent),
  fontSize: {
    label: 'Text size',
    group: 'text',
    needs: 'text',
    min: 1,
    max: 2000,
    unit: 'canvas pixels',
    read: (item) => item.text?.fontSize ?? 96,
    format: px
  },
  letterSpacing: {
    label: 'Tracking',
    group: 'text',
    needs: 'text',
    min: -100,
    max: 100,
    unit: 'canvas pixels between letters',
    read: (item) => item.text?.letterSpacing ?? 0,
    format: px
  },
  speed: {
    label: 'Speed',
    group: 'time',
    needs: 'source',
    min: 0,
    max: 16,
    unit: 'a playback rate, 1 source speed, 0 a held frame',
    read: (item) => item.speed,
    format: percent,
    planned:
      'Speed is not keyed through `keyframes`: a speed key changes how much footage the clip reads, so its ' +
      'length has to change with it. Pass edit_item `speedRamp` instead — a preset name, or a list of ' +
      '{ frame, speed, ease? } — and `speedRamp: null` to go back to one constant speed.'
  }
}

/**
 * The properties a general keyframe control or tool may write: every row not marked `planned`.
 * What the Animate picker lists, the graph draws, and `mergeKeyframes` accepts and names.
 */
export const WRITABLE_KEYFRAME_PROPERTIES: readonly KeyframeProperty[] = KEYFRAME_PROPERTIES.filter(
  (property) => !KEYFRAME_REGISTRY[property].planned
)

const CROP_KEYS: readonly [KeyframeProperty, keyof Crop][] = [
  ['cropLeft', 'left'],
  ['cropTop', 'top'],
  ['cropRight', 'right'],
  ['cropBottom', 'bottom']
]

const ADJUSTMENT_KEYS: readonly (keyof Adjustments & KeyframeProperty)[] = [
  'brightness',
  'contrast',
  'saturate',
  'hueRotate',
  'blur',
  'grayscale',
  'sepia',
  'invert'
]

/**
 * `item` with the sampled `values` of its crop, adjustment and text keys written in: the same
 * object when `values` names none of them. A crop is normalised as a typed one is, so two keyed
 * edges can never together take the whole source.
 */
export function withSampledStatics(item: Item, values: (property: KeyframeProperty) => number | undefined): Item {
  let out = item

  let crop: Crop | null = null
  for (const [property, edge] of CROP_KEYS) {
    const value = values(property)
    if (value === undefined) continue
    crop ??= { ...(item.crop ?? NO_CROP) }
    crop[edge] = value
  }
  if (crop) out = { ...out, crop: normaliseCrop(crop) }

  let adjustments: Adjustments | null = null
  for (const property of ADJUSTMENT_KEYS) {
    const value = values(property)
    if (value === undefined) continue
    adjustments ??= adjustmentsOf(item.adjustments)
    adjustments[property] = value
  }
  if (adjustments) out = { ...out, adjustments }

  // A title with no style of its own has nothing to write a size into; the keys wait for one.
  if (item.text) {
    const fontSize = values('fontSize')
    const letterSpacing = values('letterSpacing')
    if (fontSize !== undefined || letterSpacing !== undefined) {
      out = {
        ...out,
        text: {
          ...item.text,
          ...(fontSize !== undefined ? { fontSize: Math.max(1, fontSize) } : {}),
          ...(letterSpacing !== undefined ? { letterSpacing } : {})
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Path families — see the header
// ---------------------------------------------------------------------------

export interface DynamicKeyframePath {
  /** What every key name of this family starts with, such as `effect.` or `mask.`. */
  prefix: string
  /** The property's label and range on `item`, or `{ error }` saying why it cannot be keyed. */
  describe(item: Item, path: string): (KeyframeRange & { label: string; format?: (value: number) => string }) | { error: string }
  /** A copy of `item` drawing with `value` at `path`. Must not throw. */
  apply(item: Item, path: string, value: number): Item
}

/** Empty in this build: the effect stack and the shape masks register here when they land. */
export const DYNAMIC_KEYFRAME_PATHS: DynamicKeyframePath[] = []

export function isStaticProperty(name: string): name is KeyframeProperty {
  return (KEYFRAME_PROPERTIES as readonly string[]).includes(name)
}

export function dynamicPathFor(name: string): DynamicKeyframePath | undefined {
  return DYNAMIC_KEYFRAME_PATHS.find((family) => name.startsWith(family.prefix))
}

/** Label and range of any keyable name on `item`, or an error naming what is keyable. */
export function keyframeInfo(
  item: Item,
  name: string
): (KeyframeRange & { label: string; format: (value: number) => string }) | { error: string } {
  if (isStaticProperty(name)) return KEYFRAME_REGISTRY[name]
  const family = dynamicPathFor(name)
  if (!family) return { error: `"${name}" is not animatable. Animatable properties: ${WRITABLE_KEYFRAME_PROPERTIES.join(', ')}.` }
  const described = family.describe(item, name)
  if ('error' in described) return described
  return { ...described, format: described.format ?? ((value) => String(Number(value.toFixed(3)))) }
}

/** The properties of `group`, in table order — what a section of the inspector offers. */
export function propertiesIn(group: KeyframeGroup): KeyframeProperty[] {
  return KEYFRAME_PROPERTIES.filter((property) => KEYFRAME_REGISTRY[property].group === group)
}
