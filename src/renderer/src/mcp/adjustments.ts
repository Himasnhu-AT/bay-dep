/**
 * Merging `adjustments` and validating `blendMode` for `edit_item`.
 *
 * Same shape and same reason as `mergeTextStyle`: the schema promises that fields **merge**,
 * so setting `saturate` leaves `brightness` where it was. A wholesale replace would make every
 * partial edit silently reset the seven values the caller did not mention, and the result would
 * read back as though that were intended.
 */

import {
  defaultAdjustments,
  type Adjustments,
  type BlendMode,
  type Item,
  type Timeline,
  type Track
} from '@shared/project'
// Imported from the module rather than from `@/engine`, because the barrel does not re-export
// `looks` — and `tsc` resolved `@/engine` happily while rollup refused it, so this was a green
// typecheck over a build that could not link. The deep path is checked by both.
import { adjustmentFilter, NO_FILTER } from '../engine/looks'
import { fail } from './helpers'

const NUMERIC: (keyof Adjustments)[] = [
  'brightness',
  'contrast',
  'saturate',
  'hueRotate',
  'blur',
  'grayscale',
  'sepia',
  'invert'
]

/** Fields that are a 0..1 proportion; anything else is unbounded above. */
const UNIT: Set<keyof Adjustments> = new Set(['grayscale', 'sepia', 'invert'])

/** Fields that cannot be negative. `hueRotate` is an angle and may be. */
const NON_NEGATIVE: Set<keyof Adjustments> = new Set([
  'brightness',
  'contrast',
  'saturate',
  'blur',
  'grayscale',
  'sepia',
  'invert'
])

/**
 * The item's adjustments with `patch` merged over them.
 *
 * Starts from `defaultAdjustments()` rather than from `{}` when the item has none, so a caller
 * who sets one field gets the identity for the other seven instead of `undefined` reaching
 * `filterStringFor`. Refuses a value it cannot honour rather than clamping quietly — a clamp
 * here would read back as the number the caller asked for having been accepted.
 */
export function mergeAdjustments(current: Adjustments | undefined, patch: unknown): Adjustments {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    fail('adjustments must be an object of named values, for example { "saturate": 0.4 }.')
  }
  const given = patch as Record<string, unknown>

  const unknownKeys = Object.keys(given).filter((key) => !NUMERIC.includes(key as keyof Adjustments))
  if (unknownKeys.length > 0) {
    fail(
      `adjustments has no field${unknownKeys.length > 1 ? 's' : ''} ` +
        `${unknownKeys.map((k) => `"${k}"`).join(', ')}. It accepts ${NUMERIC.join(', ')}.`
    )
  }

  const next: Adjustments = { ...defaultAdjustments(), ...current }
  for (const key of NUMERIC) {
    if (given[key] === undefined) continue
    const value = Number(given[key])
    if (!Number.isFinite(value)) {
      fail(`adjustments.${key} must be a finite number; got ${JSON.stringify(given[key])}.`)
    }
    if (NON_NEGATIVE.has(key) && value < 0) {
      fail(`adjustments.${key} cannot be negative; got ${value}.`)
    }
    if (UNIT.has(key) && value > 1) {
      fail(`adjustments.${key} is a proportion from 0 to 1; got ${value}.`)
    }
    next[key] = value
  }
  return next
}

/**
 * What an agent needs told about the look it just set, or null when there is nothing to say.
 *
 * Two things are invisible from the tool result alone and both would otherwise be discovered
 * by looking at an unchanged picture and blaming the compositor:
 *
 * - **Adjustments that amount to the identity.** Setting `brightness: 1` is accepted, stored,
 *   and changes nothing. The compositor's own `adjustmentFilter` returning `NO_FILTER` is
 *   exactly that condition, so it is the thing to report.
 *
 * The filter reported here comes from **`adjustmentFilter`, the engine's builder — not from
 * `filterStringFor` in `@shared/project`**, and that is deliberate rather than incidental. Two
 * implementations of this mapping exist, and they disagree: `filterStringFor` places `blur`
 * fifth in the chain while the compositor places it last, on the documented reasoning that
 * blur should act on the corrected colour rather than on colour about to be corrected. Filter
 * order changes the image, so those are two different pictures. Whatever this result calls
 * "the filter the compositor will use" has to come from the thing that composites, or the
 * field is a confident lie about a picture the caller cannot see. See
 * `lib/looks-agree.test.ts` for the divergence in full.
 * - **A blend mode on the lowest video track**, where there is nothing underneath. Every mode
 *   looks identical there, so `multiply` reads as broken rather than as inapplicable.
 */
export function lookWarnings(
  item: Item,
  track: Track,
  timeline: Timeline
): { filter: string | null; warnings: string[] } {
  const warnings: string[] = []
  const built = adjustmentFilter(item.adjustments)
  const filter = built === NO_FILTER ? null : built

  if (item.adjustments && filter === null) {
    warnings.push(
      'These adjustments are the identity values, so nothing will look different. That is ' +
        'stored, not ignored — but if you expected a visible change, the numbers are the reason.'
    )
  }

  if (item.blendMode && item.blendMode !== 'normal') {
    const videoTracks = timeline.tracks.filter((candidate) => candidate.kind === 'video')
    // Later entries render on top, so the first video track is the bottom of the stack.
    if (videoTracks[0]?.id === track.id) {
      warnings.push(
        `blendMode "${item.blendMode}" is set on ${track.name}, which is the lowest video ` +
          `track — there is nothing beneath it to blend with, so every mode looks the same ` +
          `here. Move the clip to a higher track, or put something under it.`
      )
    }
  }

  return { filter, warnings }
}

/** Validation for `blendMode`, kept beside the merge so both refusals read alike. */
export function asBlendMode(given: unknown, allowed: readonly string[]): BlendMode {
  const value = String(given)
  if (!allowed.includes(value)) {
    fail(`blendMode "${value}" is not one of: ${allowed.join(', ')}.`)
  }
  return value as BlendMode
}
