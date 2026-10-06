/**
 * What a video effect is: the model an item stores, and the declaration each effect file makes.
 *
 * An item's `effects` is an ordered stack. Each entry names a `kind` from the catalog beside this
 * file and carries plain parameters — a number, a `#RRGGBB` colour, an `[x, y]` point or a
 * boolean, and nothing else — so a stored stack is readable by an agent, diffable, and each
 * parameter is addressable by a path (`effects[<id>].<param>`, `./paths.ts`) for a keyframe pass
 * to animate later.
 *
 * The compositor draws the stack in its WebGL pass (`engine/effects.ts`) between the grade and the
 * masks: grade → effects, first to last → masks → adjustments, blend, opacity. Its own module so
 * `@shared/project` can name `Effect` without importing the catalog.
 */

/** A stored parameter value. A colour is `#RRGGBB`; a point is `[x, y]`, 0..1 of the clip's picture from its top-left. */
export type EffectParamValue = number | boolean | string | [number, number]

export interface Effect {
  /** Unique within its item's stack. What `edit_effects` and the store address an effect by. */
  id: string
  /** A catalog kind (`EFFECT_KINDS`). A kind this build does not know is skipped and reported. */
  kind: string
  /** Absent or true draws it; false keeps it in the stack, bypassed. */
  enabled?: boolean
  params: Record<string, EffectParamValue>
}

interface ParamBase {
  label: string
  /** A shorter caption for the inspector's 64px label column, where `label` would be cut off. */
  caption?: string
  /** One line for the agent: what the number means and which way is more. */
  description: string
}

export interface NumberParam extends ParamBase {
  type: 'number'
  min: number
  max: number
  step: number
  default: number
  /** Shown after the number: 'px' is timeline pixels, '°' degrees. */
  unit?: string
}

export interface ColorParam extends ParamBase {
  type: 'color'
  /** `#RRGGBB`. */
  default: string
}

export interface PointParam extends ParamBase {
  type: 'point'
  /** `[x, y]`, each 0..1 of the clip's picture from its top-left. */
  default: [number, number]
}

export interface BooleanParam extends ParamBase {
  type: 'boolean'
  default: boolean
}

export type EffectParam = NumberParam | ColorParam | PointParam | BooleanParam

export type EffectCategory = 'blur' | 'stylize' | 'colour' | 'distort' | 'key'

export const EFFECT_CATEGORY_LABEL: Record<EffectCategory, string> = {
  blur: 'Blur and sharpen',
  stylize: 'Stylize',
  colour: 'Colour',
  distort: 'Distort',
  key: 'Keying'
}

/** A parameter as the shader takes it: a colour is an RGB triple 0..1, everything else as stored. */
export type ResolvedValue = number | boolean | [number, number] | [number, number, number]
export type ResolvedParams = Record<string, ResolvedValue>

export interface EffectSpec {
  kind: string
  label: string
  category: EffectCategory
  /** What it does and when to reach for it, for the library row and the agent. */
  description: string
  /** In the order the inspector shows them. */
  params: Record<string, EffectParam>
  /**
   * Whether these complete, in-range parameters draw the source unchanged. Such an effect runs no
   * pass at all — the `'none'` rule — so an effect added and left at zero costs nothing.
   */
  isIdentity(params: ResolvedParams): boolean
}

/** Reads of a resolved parameter by the type its spec declared. Wrong type reads as the neutral value. */
export function num(params: ResolvedParams, key: string): number {
  const value = params[key]
  return typeof value === 'number' ? value : 0
}

export function flag(params: ResolvedParams, key: string): boolean {
  return params[key] === true
}

export function rgb(params: ResolvedParams, key: string): [number, number, number] {
  const value = params[key]
  return Array.isArray(value) && value.length === 3 ? value : [0, 0, 0]
}

export function point(params: ResolvedParams, key: string): [number, number] {
  const value = params[key]
  return Array.isArray(value) && value.length === 2 ? value : [0.5, 0.5]
}

/** Below this an amount is nothing: the identity epsilon `adjustmentFilter` uses, for the same reason. */
export const EFFECT_EPSILON = 1e-6
