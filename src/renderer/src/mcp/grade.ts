/**
 * Merging and validating `grade` for `edit_item`.
 *
 * Same contract as `mergeAdjustments`: fields **merge**, so setting `saturation` leaves the wheels
 * where they were, and a value the compositor cannot honour is refused rather than clamped — a
 * clamp reads back as the number the caller asked for having been accepted. Every refusal names
 * the field, the legal range and what to send instead, because the caller is usually an agent that
 * cannot see the picture and needs the next call to work.
 *
 * Pure (the asset lookup is injected), so it is tested without a store.
 */

import { GRADEABLE_KINDS, hexToRgb, MAX_CURVE_POINTS, resolveGrade, type CurvePoint, type Grade, type GradeWheel } from '@shared/grade'
import type { Asset } from '@shared/project'
import { fail } from './helpers'

type Range = readonly [number, number]

const WHEEL_RANGE: Record<'lift' | 'gamma' | 'gain', Range> = {
  lift: [-1, 1],
  gamma: [-0.9, 4],
  gain: [-1, 4]
}

const FIELDS = [
  'lift', 'gamma', 'gain', 'temperature', 'tint', 'saturation', 'curves', 'lut', 'grain', 'halation', 'vignette'
] as const

const GROUPS = {
  grain: { amount: [0, 1], size: [0.5, 16] },
  halation: { amount: [0, 1], threshold: [0, 0.99], radius: [0.5, 200] },
  vignette: { amount: [0, 1] }
} as const satisfies Record<string, Record<string, Range>>

export { GRADEABLE_KINDS } from '@shared/grade'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function number(path: string, value: unknown, [low, high]: Range): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n) || n < low || n > high) {
    fail(`grade.${path} must be a number from ${low} to ${high}; got ${JSON.stringify(value)}.`)
  }
  return n
}

function unknownKeys(path: string, given: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(given).filter((key) => !allowed.includes(key))
  if (extra.length > 0) {
    fail(
      `grade${path ? `.${path}` : ''} has no field${extra.length > 1 ? 's' : ''} ` +
        `${extra.map((k) => `"${k}"`).join(', ')}. It accepts ${allowed.join(', ')}.`
    )
  }
}

function mergeWheel(name: 'lift' | 'gamma' | 'gain', current: GradeWheel | undefined, patch: unknown): GradeWheel {
  if (!isObject(patch)) {
    fail(`grade.${name} is a colour wheel: an object of RGB offsets such as { "r": 0.02, "g": 0, "b": -0.02 }.`)
  }
  unknownKeys(name, patch, ['r', 'g', 'b'])
  const next: GradeWheel = { r: 0, g: 0, b: 0, ...current }
  for (const channel of ['r', 'g', 'b'] as const) {
    if (patch[channel] !== undefined) next[channel] = number(`${name}.${channel}`, patch[channel], WHEEL_RANGE[name])
  }
  return next
}

function curve(path: string, value: unknown): CurvePoint[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CURVE_POINTS) {
    fail(
      `grade.${path} must be a list of 1 to ${MAX_CURVE_POINTS} [input, output] points from 0 to 1, ` +
        `for example [[0.25, 0.22], [0.75, 0.8]]. (0,0) and (1,1) are added when you leave the ends out.`
    )
  }
  const points = value.map((point, i): CurvePoint => {
    if (!Array.isArray(point) || point.length !== 2) {
      fail(`grade.${path}[${i}] must be an [input, output] pair; got ${JSON.stringify(point)}.`)
    }
    return [number(`${path}[${i}][0]`, point[0], [0, 1]), number(`${path}[${i}][1]`, point[1], [0, 1])]
  })
  const xs = points.map((p) => p[0]).sort((a, b) => a - b)
  for (let i = 1; i < xs.length; i += 1) {
    if ((xs[i] as number) - (xs[i - 1] as number) < 1e-6) {
      fail(`grade.${path} has two points at input ${xs[i]}; each input may appear once.`)
    }
  }
  return points
}

/**
 * The item's grade with `patch` merged over it, or `undefined` when the patch clears it.
 * `null` for the whole grade, or for any one group, removes it.
 */
export function mergeGrade(
  current: Grade | undefined,
  patch: unknown,
  assetById: (id: string) => Asset | undefined
): Grade | undefined {
  if (patch === null) return undefined
  if (!isObject(patch)) {
    fail('grade must be an object, for example { "saturation": 0.9, "gain": { "r": 0.03, "g": 0, "b": -0.02 } }, or null to remove it.')
  }
  unknownKeys('', patch, FIELDS)
  const next: Grade = { ...current }

  for (const wheel of ['lift', 'gamma', 'gain'] as const) {
    if (patch[wheel] === undefined) continue
    if (patch[wheel] === null) delete next[wheel]
    else next[wheel] = mergeWheel(wheel, current?.[wheel], patch[wheel])
  }
  const scalars = { temperature: [-3000, 3000], tint: [-1, 1], saturation: [0, 4] } as const
  for (const key of Object.keys(scalars) as (keyof typeof scalars)[]) {
    if (patch[key] === undefined) continue
    if (patch[key] === null) delete next[key]
    else next[key] = number(key, patch[key], scalars[key])
  }

  if (patch.curves !== undefined) {
    if (patch.curves === null) delete next.curves
    else {
      if (!isObject(patch.curves)) {
        fail('grade.curves is an object of curves by channel: { master, r, g, b }, each a list of [input, output] points.')
      }
      unknownKeys('curves', patch.curves, ['master', 'r', 'g', 'b'])
      const curves = { ...next.curves }
      for (const channel of ['master', 'r', 'g', 'b'] as const) {
        const given = patch.curves[channel]
        if (given === undefined) continue
        if (given === null) delete curves[channel]
        else curves[channel] = curve(`curves.${channel}`, given)
      }
      if (Object.keys(curves).length > 0) next.curves = curves
      else delete next.curves
    }
  }

  if (patch.lut !== undefined) {
    if (patch.lut === null) delete next.lut
    else {
      if (!isObject(patch.lut)) {
        fail('grade.lut is { "assetId": "<a lut asset>", "intensity": 0..1 }. Import a .cube file with import_media to get one.')
      }
      unknownKeys('lut', patch.lut, ['assetId', 'intensity'])
      const assetId = patch.lut.assetId ?? next.lut?.assetId
      if (typeof assetId !== 'string') {
        fail('grade.lut needs an assetId: the id import_media returned for a .cube file (kind "lut").')
      }
      const asset = assetById(assetId)
      if (!asset || asset.kind !== 'lut') {
        fail(
          asset
            ? `Asset ${assetId} (${asset.name}) is a ${asset.kind}, not a LUT. grade.lut takes the id of a .cube file imported with import_media.`
            : `No asset ${assetId}. Import the .cube file with import_media and use the id it returns (kind "lut").`
        )
      }
      if (asset.error || !asset.lut) {
        fail(`${asset.name} could not be read as a LUT (${asset.error ?? 'no table'}), so it cannot be applied. Choose another .cube file.`)
      }
      const intensity = patch.lut.intensity === undefined
        ? (next.lut?.intensity ?? 1)
        : number('lut.intensity', patch.lut.intensity, [0, 1])
      next.lut = { assetId, intensity }
    }
  }

  for (const group of ['grain', 'halation', 'vignette'] as const) {
    const given = patch[group]
    if (given === undefined) continue
    if (given === null) {
      delete next[group]
      continue
    }
    const ranges: Record<string, Range> = GROUPS[group]
    const allowed = [...Object.keys(ranges), ...(group === 'halation' ? ['color'] : [])]
    if (!isObject(given)) fail(`grade.${group} is an object of ${allowed.join(', ')}, or null to remove it.`)
    unknownKeys(group, given, allowed)
    const merged: Record<string, unknown> = { ...(next[group] as Record<string, unknown> | undefined) }
    for (const [key, range] of Object.entries(ranges)) {
      if (given[key] !== undefined) merged[key] = number(`${group}.${key}`, given[key], range)
    }
    if (group === 'halation' && given.color !== undefined) {
      if (typeof given.color !== 'string' || !hexToRgb(given.color)) {
        fail(`grade.halation.color must be a hex colour such as "#FF8C40"; got ${JSON.stringify(given.color)}.`)
      }
      merged.color = given.color
    }
    if (merged.amount === undefined) {
      fail(`grade.${group} needs an amount from 0 to 1 — without one it does nothing. For example { "amount": 0.2 }.`)
    }
    ;(next as Record<string, unknown>)[group] = merged
  }

  return Object.keys(next).length > 0 ? next : undefined
}

/** What an agent should be told about the grade it just set, most hidden fault first. */
export function gradeWarnings(grade: Grade | undefined, asset: Asset | undefined): string[] {
  const warnings: string[] = []
  if (grade && resolveGrade(grade) === null) {
    warnings.push(
      'This grade is the identity, so nothing will look different — it is stored, but every value is ' +
        'at its neutral setting (wheels 0, saturation 1, amounts 0).'
    )
  }
  if (grade && asset && !(GRADEABLE_KINDS as readonly string[]).includes(asset.kind)) {
    warnings.push(`${asset.name} is ${asset.kind}, which has no picture to grade.`)
  }
  return warnings
}
