/**
 * The video effect catalog: every effect file beside this one, in library order.
 *
 * An effect is a file here exporting `order` and `effect` (its parameters, ranges, defaults and
 * identity) plus a shader of the same kind in `engine/effectShaders.ts`. This index is written by
 * hand rather than generated — one author adds effects, so there is no merge to resolve — and
 * `catalog.test.ts` reads the directory and fails when a file is missing from it or a kind has no
 * shader, which is the guard generation would have given.
 */

import { effect as chromaKey, order as chromaKeyOrder } from './chroma-key'
import { effect as chromaticAberration, order as chromaticAberrationOrder } from './chromatic-aberration'
import { effect as directionalBlur, order as directionalBlurOrder } from './directional-blur'
import { effect as duotone, order as duotoneOrder } from './duotone'
import { effect as flip, order as flipOrder } from './flip'
import { effect as glitch, order as glitchOrder } from './glitch'
import { effect as glow, order as glowOrder } from './glow'
import { effect as mirror, order as mirrorOrder } from './mirror'
import { effect as pixelate, order as pixelateOrder } from './pixelate'
import { effect as sharpen, order as sharpenOrder } from './sharpen'
import { effect as tint, order as tintOrder } from './tint'
import { effect as zoomBlur, order as zoomBlurOrder } from './zoom-blur'
import type { EffectParam, EffectSpec } from './spec'

export * from './spec'

const ENTRIES: [number, EffectSpec][] = [
  [chromaKeyOrder, chromaKey],
  [chromaticAberrationOrder, chromaticAberration],
  [directionalBlurOrder, directionalBlur],
  [duotoneOrder, duotone],
  [flipOrder, flip],
  [glitchOrder, glitch],
  [glowOrder, glow],
  [mirrorOrder, mirror],
  [pixelateOrder, pixelate],
  [sharpenOrder, sharpen],
  [tintOrder, tint],
  [zoomBlurOrder, zoomBlur]
]

/** Every effect, in the order the library lists them. */
export const EFFECTS: readonly EffectSpec[] = ENTRIES.slice().sort((a, b) => a[0] - b[0]).map(([, spec]) => spec)

export const EFFECT_KINDS: readonly string[] = EFFECTS.map((spec) => spec.kind)

const BY_KIND = new Map(EFFECTS.map((spec) => [spec.kind, spec]))

export function effectSpec(kind: string): EffectSpec | undefined {
  return BY_KIND.get(kind)
}

/** The most effects one clip may carry. Each is at least one full-size pass per frame. */
export const MAX_EFFECTS = 16

/**
 * The asset kinds an effect can draw on: what the compositor paints as a picture source, which is
 * what a grade reaches too. Text draws its own glyphs and audio has no picture.
 */
export const EFFECT_ITEM_KINDS = ['video', 'image', 'gif', 'html', 'brf', 'adjustment'] as const

export function takesEffects(kind: string | undefined): boolean {
  return (EFFECT_ITEM_KINDS as readonly string[]).includes(kind ?? '')
}

/** One parameter as an agent reads it: its type, range and default in a few words. */
export function describeParam(name: string, param: EffectParam): string {
  switch (param.type) {
    case 'number':
      return `${name} ${param.min}..${param.max}${param.unit ?? ''} (default ${param.default})`
    case 'color':
      return `${name} "#RRGGBB" (default "${param.default}")`
    case 'point':
      return `${name} [x, y] each 0..1 (default [${param.default.join(', ')}])`
    case 'boolean':
      return `${name} true|false (default ${param.default})`
  }
}

/** The whole catalog as text, for a tool description: one line per effect, generated so it cannot go stale. */
export function describeCatalog(): string {
  return EFFECTS.map((spec) => {
    const params = Object.entries(spec.params).map(([name, param]) => describeParam(name, param)).join('; ')
    // The first sentence is what it does; the rest (when not to use it) is in the library row.
    const what = spec.description.split('. ')[0]?.replace(/\.$/, '') ?? spec.label
    return `${spec.kind} — ${what}. Params: ${params}.`
  }).join('\n')
}
