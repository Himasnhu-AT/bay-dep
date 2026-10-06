/**
 * From a stored effect stack to what the compositor draws.
 *
 * `resolveEffects` is the one reading of `item.effects`: the engine draws its `active` list in
 * order, the inspector and `edit_effects` report from it, and nothing else decides whether an
 * effect runs. It follows the grade's rules (`resolveGrade`): an effect that is switched off, or
 * whose parameters draw the source unchanged, is not in the list — so a stack that does nothing
 * resolves to `null` and the clip takes the plain draw path; and one bad value falls back to that
 * parameter's default rather than taking the effect, or the stack, down with it.
 *
 * A stored value is never trusted to be in range — a `.bay` may be anyone's — so numbers are
 * clamped here. `edit_effects` refuses out-of-range values before they are stored (`./edit.ts`);
 * the clamp is for what arrives some other way, and bounds the shader's loops.
 */

import { hexToRgb } from '../grade'
import { effectSpec } from './index'
import type { Effect, EffectParam, EffectSpec, ResolvedParams, ResolvedValue } from './spec'

export interface ResolvedEffect {
  id: string
  kind: string
  spec: EffectSpec
  params: ResolvedParams
}

export interface ResolvedStack {
  /** The effects that draw, in stack order. */
  active: ResolvedEffect[]
  /**
   * What in the stack could not be drawn as stored, in words: an effect of a kind this build does
   * not have. The clip is then drawn without it, which is a wrong picture — the compositor reports
   * each through the same channel as a failed grade.
   */
  issues: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One parameter as the shader takes it; anything unusable reads as the parameter's default. */
export function resolveParam(param: EffectParam, value: unknown): ResolvedValue {
  switch (param.type) {
    case 'number': {
      const n = typeof value === 'number' && Number.isFinite(value) ? value : param.default
      return Math.min(param.max, Math.max(param.min, n))
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : param.default
    case 'color': {
      const parsed = typeof value === 'string' ? hexToRgb(value) : null
      // The default is a literal in the catalog and `catalog.test.ts` checks every one parses.
      return parsed ?? hexToRgb(param.default) ?? [0, 0, 0]
    }
    case 'point': {
      if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        return [Math.min(1, Math.max(0, value[0] as number)), Math.min(1, Math.max(0, value[1] as number))]
      }
      return [param.default[0], param.default[1]]
    }
  }
}

/** Every parameter the spec declares, resolved; keys the spec does not declare are dropped. */
export function resolveParams(spec: EffectSpec, params: unknown): ResolvedParams {
  const given = isObject(params) ? params : {}
  const out: ResolvedParams = {}
  for (const [key, param] of Object.entries(spec.params)) out[key] = resolveParam(param, given[key])
  return out
}

/**
 * The stack the compositor will run, or `null` when it would draw nothing and has nothing to
 * report — the signal to skip the pass.
 */
export function resolveEffects(effects: readonly Effect[] | undefined | null): ResolvedStack | null {
  if (!Array.isArray(effects) || effects.length === 0) return null
  const active: ResolvedEffect[] = []
  const issues: string[] = []
  for (const entry of effects as readonly unknown[]) {
    if (!isObject(entry) || typeof entry.kind !== 'string') {
      issues.push('an entry in its effects is not an effect, so it was skipped')
      continue
    }
    if (entry.enabled === false) continue
    const spec = effectSpec(entry.kind)
    if (!spec) {
      issues.push(`its effect "${entry.kind}" is not one this build of bay has, so it was skipped`)
      continue
    }
    const params = resolveParams(spec, entry.params)
    if (spec.isIdentity(params)) continue
    active.push({ id: typeof entry.id === 'string' ? entry.id : '', kind: spec.kind, spec, params })
  }
  return active.length === 0 && issues.length === 0 ? null : { active, issues }
}

/** Whether a stored effect would run a pass: on, known, and not at its identity. */
export function effectDraws(effect: Effect): boolean {
  return (resolveEffects([effect])?.active.length ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Parameter paths
// ---------------------------------------------------------------------------

/**
 * The address of one effect parameter on an item: `effects[<id>].<param>`. By id, not by index,
 * so reordering the stack does not re-aim an animation. Nothing animates these yet; the path is
 * the contract a keyframe pass will key on, and the values are already plain enough to
 * interpolate (a number, each channel of a colour, each axis of a point; a boolean holds).
 */
export function effectParamPath(effectId: string, param: string): string {
  return `effects[${effectId}].${param}`
}

export function parseEffectParamPath(path: string): { effectId: string; param: string } | null {
  const match = /^effects\[([^\]]+)\]\.([A-Za-z][A-Za-z0-9]*)$/.exec(path)
  if (!match || !match[1] || !match[2]) return null
  return { effectId: match[1], param: match[2] }
}

/** The parameter a path names on this stack, with its declaration, or null when it names none. */
export function effectParamAt(
  effects: readonly Effect[] | undefined,
  path: string
): { effect: Effect; param: EffectParam; value: ResolvedValue } | null {
  const parsed = parseEffectParamPath(path)
  if (!parsed) return null
  const effect = effects?.find((candidate) => candidate.id === parsed.effectId)
  const param = effect ? effectSpec(effect.kind)?.params[parsed.param] : undefined
  if (!effect || !param) return null
  return { effect, param, value: resolveParam(param, effect.params?.[parsed.param]) }
}
