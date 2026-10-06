/**
 * Changing an effect stack: validation, and the operations `edit_effects` and the store share.
 *
 * Same contract as `mergeGrade`: a value the compositor would have to clamp is **refused**, never
 * stored — a clamp reads back as the number the caller asked for having been accepted — and every
 * refusal names the parameter, its legal range and what the effect does accept, because the caller
 * is usually an agent that cannot see the picture and needs its next call to work.
 *
 * Pure: no store, no ids of its own (`makeId` is injected). `EffectEditError` is a plain error;
 * the tool turns it into its refusal and the store's actions never see one, since they are given
 * values this file has already passed.
 */

import { hexToRgb } from '../grade'
import { describeParam, EFFECT_KINDS, effectSpec, MAX_EFFECTS } from './index'
import type { Effect, EffectParam, EffectParamValue, EffectSpec } from './spec'

export class EffectEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EffectEditError'
  }
}

function refuse(message: string): never {
  throw new EffectEditError(message)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The value as it will be stored, or a refusal naming what `kind.name` accepts. */
export function checkParam(kind: string, name: string, param: EffectParam, value: unknown): EffectParamValue {
  const got = `got ${JSON.stringify(value)}`
  switch (param.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < param.min || value > param.max) {
        refuse(`${kind}.${name} must be a number from ${param.min} to ${param.max}${param.unit ? ` (${param.unit})` : ''}; ${got}. ${param.description}`)
      }
      return value
    case 'boolean':
      if (typeof value !== 'boolean') refuse(`${kind}.${name} must be true or false; ${got}. ${param.description}`)
      return value
    case 'color': {
      if (typeof value !== 'string' || !hexToRgb(value)) {
        refuse(`${kind}.${name} must be a hex colour such as "${param.default}"; ${got}.`)
      }
      const hex = value.trim().toUpperCase()
      return hex.startsWith('#') ? hex : `#${hex}`
    }
    case 'point':
      if (
        !Array.isArray(value) || value.length !== 2 ||
        !value.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
      ) {
        refuse(`${kind}.${name} must be a point [x, y], each from 0 to 1 of the clip's picture from its top-left, such as [0.5, 0.5]; ${got}.`)
      }
      return [value[0] as number, value[1] as number]
  }
}

function paramList(spec: EffectSpec): string {
  return Object.entries(spec.params).map(([name, param]) => describeParam(name, param)).join('; ')
}

/** A partial set of parameters for `spec`, checked. Unknown names are refused with the real ones. */
export function checkParams(spec: EffectSpec, given: unknown): Record<string, EffectParamValue> {
  if (given === undefined) return {}
  if (!isObject(given)) {
    refuse(`${spec.kind} params must be an object of its parameters: ${paramList(spec)}.`)
  }
  const out: Record<string, EffectParamValue> = {}
  for (const [name, value] of Object.entries(given)) {
    const param = spec.params[name]
    if (!param) refuse(`${spec.kind} has no parameter "${name}". It takes: ${paramList(spec)}.`)
    out[name] = checkParam(spec.kind, name, param, value)
  }
  return out
}

/** Every parameter of `spec` at its default — what a freshly added effect stores. */
export function defaultParams(spec: EffectSpec): Record<string, EffectParamValue> {
  const out: Record<string, EffectParamValue> = {}
  for (const [name, param] of Object.entries(spec.params)) {
    out[name] = param.type === 'point' ? [param.default[0], param.default[1]] : param.default
  }
  return out
}

function specOf(kind: unknown): EffectSpec {
  const spec = typeof kind === 'string' ? effectSpec(kind) : undefined
  if (!spec) {
    refuse(`There is no effect ${JSON.stringify(kind)}. The effects are: ${EFFECT_KINDS.join(', ')}.`)
  }
  return spec
}

/**
 * A new effect of `kind`, every parameter stored (the defaults under whatever was given), so a
 * later change to a default cannot change a picture already made.
 */
export function makeEffect(kind: unknown, params: unknown, id: string, enabled?: unknown): Effect {
  const spec = specOf(kind)
  if (enabled !== undefined && typeof enabled !== 'boolean') refuse(`enabled must be true or false; got ${JSON.stringify(enabled)}.`)
  const effect: Effect = { id, kind: spec.kind, params: { ...defaultParams(spec), ...checkParams(spec, params) } }
  if (enabled === false) effect.enabled = false
  return effect
}

function describeStack(effects: readonly Effect[]): string {
  if (effects.length === 0) return 'This clip has no effects.'
  return `Its effects, in order: ${effects.map((e, i) => `${i} ${e.id} (${e.kind})`).join(', ')}.`
}

function find(effects: readonly Effect[], given: unknown): number {
  if (typeof given !== 'string' || given.trim() === '') {
    refuse(`effectId is required: the id of an effect on this clip. ${describeStack(effects)}`)
  }
  const needle = given.trim()
  const exact = effects.findIndex((e) => e.id === needle)
  if (exact >= 0) return exact
  const matches = effects.map((e, i) => ({ e, i })).filter(({ e }) => e.id.startsWith(needle))
  if (matches.length === 1 && matches[0]) return matches[0].i
  if (matches.length > 1) refuse(`"${needle}" matches ${matches.length} effects on this clip; use more of the id. ${describeStack(effects)}`)
  refuse(`No effect "${needle}" on this clip. ${describeStack(effects)}`)
}

function index(given: unknown, name: string, max: number): number {
  if (typeof given !== 'number' || !Number.isInteger(given) || given < 0 || given > max) {
    refuse(`${name} must be a whole number from 0 (first, drawn first) to ${max}; got ${JSON.stringify(given)}.`)
  }
  return given
}

export const EFFECT_OPS = ['add', 'update', 'move', 'remove', 'clear'] as const

export interface EffectOpsResult {
  /** The stack after every operation. Empty means the item's `effects` should be removed. */
  effects: Effect[]
  /** The ids `add` operations made, in order. */
  added: string[]
}

/**
 * Applies `operations` in order to a copy of `current` and returns the result, or throws at the
 * first one that cannot be done — in which case nothing was changed, so a batch is all or nothing.
 *
 *   { op: 'add', kind, params?, enabled?, index? }   — at the end, or at `index`
 *   { op: 'update', effectId, params?, enabled? }    — params merge over what it has
 *   { op: 'move', effectId, toIndex }
 *   { op: 'remove', effectId }
 *   { op: 'clear' }
 */
export function applyEffectOps(current: readonly Effect[] | undefined, operations: unknown, makeId: () => string): EffectOpsResult {
  if (!Array.isArray(operations) || operations.length === 0) {
    refuse('operations must be a non-empty list, for example [{ "op": "add", "kind": "glow", "params": { "amount": 0.8 } }].')
  }
  const effects: Effect[] = (current ?? []).map((e) => ({ ...e, params: { ...e.params } }))
  const added: string[] = []
  operations.forEach((operation: unknown, at: number) => {
    const where = `operations[${at}]`
    if (!isObject(operation)) refuse(`${where} must be an object with an "op": one of ${EFFECT_OPS.join(', ')}.`)
    try {
      switch (operation.op) {
        case 'add': {
          if (effects.length >= MAX_EFFECTS) {
            refuse(`A clip takes at most ${MAX_EFFECTS} effects and this one has ${effects.length}. Remove one first.`)
          }
          const made = makeEffect(operation.kind, operation.params, makeId(), operation.enabled)
          const to = operation.index === undefined ? effects.length : index(operation.index, 'index', effects.length)
          effects.splice(to, 0, made)
          added.push(made.id)
          return
        }
        case 'update': {
          const i = find(effects, operation.effectId)
          const target = effects[i] as Effect
          if (operation.params === undefined && operation.enabled === undefined) {
            refuse('update needs params, enabled, or both — without either it changes nothing.')
          }
          if (operation.enabled !== undefined && typeof operation.enabled !== 'boolean') {
            refuse(`enabled must be true or false; got ${JSON.stringify(operation.enabled)}.`)
          }
          const spec = effectSpec(target.kind)
          if (operation.params !== undefined) {
            if (!spec) {
              refuse(`Effect ${target.id} is "${target.kind}", which this build of bay does not have, so its parameters cannot be checked. Remove it, or switch it off with enabled: false.`)
            }
            target.params = { ...target.params, ...checkParams(spec, operation.params) }
          }
          if (operation.enabled === false) target.enabled = false
          else if (operation.enabled === true) delete target.enabled
          return
        }
        case 'move': {
          const i = find(effects, operation.effectId)
          const to = index(operation.toIndex, 'toIndex', effects.length - 1)
          const [moved] = effects.splice(i, 1)
          if (moved) effects.splice(to, 0, moved)
          return
        }
        case 'remove': {
          effects.splice(find(effects, operation.effectId), 1)
          return
        }
        case 'clear':
          effects.length = 0
          return
        default:
          refuse(`"op" must be one of ${EFFECT_OPS.join(', ')}; got ${JSON.stringify(operation.op)}.`)
      }
    } catch (error) {
      if (error instanceof EffectEditError && !error.message.startsWith('operations[')) {
        throw new EffectEditError(`${where}: ${error.message}`)
      }
      throw error
    }
  })
  return { effects, added }
}
