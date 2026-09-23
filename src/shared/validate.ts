/**
 * Argument validation against a tool's `inputSchema`.
 *
 * A deliberately small validator rather than a dependency: the schemas in `shared/mcp.ts`
 * use exactly `type`, `properties`, `required`, `items`, `enum`, `minimum` and `maximum`,
 * and pulling in a general JSON Schema implementation to cover keywords nothing uses would
 * be a lot of surface for no reach. It fails closed — a keyword it does not understand is
 * ignored, but an argument the schema does not declare is rejected, so a typo'd field name
 * is caught rather than silently dropped.
 *
 * Every message here is written to be acted on. An agent that reads "expected integer, got
 * string" can retry; one that reads "validation failed" cannot, and will either give up or
 * repeat the same call.
 */

import type { ToolSpec } from './mcp'

type Schema = Record<string, unknown>

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** `"a", "b" or "c"` — reads as a sentence, which is where these end up. */
function list(values: readonly string[]): string {
  if (values.length <= 1) return values.map((v) => `"${v}"`).join('')
  return `${values.slice(0, -1).map((v) => `"${v}"`).join(', ')} or "${values[values.length - 1]}"`
}

function checkValue(value: unknown, schema: Schema, path: string): string | null {
  const expected = schema.type as string | undefined

  if (expected === 'integer' || expected === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return `${path} must be a number, but got ${typeName(value)}.`
    }
    if (expected === 'integer' && !Number.isInteger(value)) {
      return `${path} must be a whole number of frames, but got ${value}. Round it.`
    }
    const min = schema.minimum as number | undefined
    const max = schema.maximum as number | undefined
    if (min !== undefined && value < min) return `${path} must be at least ${min}, but got ${value}.`
    if (max !== undefined && value > max) return `${path} must be at most ${max}, but got ${value}.`
    return null
  }

  if (expected === 'string') {
    if (typeof value !== 'string') return `${path} must be a string, but got ${typeName(value)}.`
    const choices = schema.enum as string[] | undefined
    if (choices && !choices.includes(value)) {
      return `${path} must be one of ${list(choices)}, but got "${value}".`
    }
    return null
  }

  if (expected === 'boolean') {
    if (typeof value !== 'boolean') return `${path} must be true or false, but got ${typeName(value)}.`
    return null
  }

  if (expected === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array, but got ${typeName(value)}.`
    const items = schema.items as Schema | undefined
    if (!items) return null
    for (let index = 0; index < value.length; index += 1) {
      const failure = checkValue(value[index], items, `${path}[${index}]`)
      if (failure) return failure
    }
    return null
  }

  return null
}

/**
 * Checks `args` against a tool's schema. Returns null when they are acceptable, or one
 * message naming the first problem — one, because an agent fixes them one at a time and a
 * list of six invites it to guess at the other five.
 */
export function validateArgs(tool: ToolSpec, args: Record<string, unknown>): string | null {
  const properties = tool.inputSchema.properties as Record<string, Schema>
  const required = tool.inputSchema.required ?? []

  for (const name of required) {
    if (args[name] === undefined || args[name] === null) {
      return `${tool.name} requires "${name}". It was not given.`
    }
  }

  const known = Object.keys(properties)
  for (const name of Object.keys(args)) {
    if (args[name] === undefined) continue
    if (!known.includes(name)) {
      // A dropped unknown field is how an agent comes to believe it set something it did
      // not. Naming what *is* accepted turns the failure into the next call.
      return known.length === 0
        ? `${tool.name} takes no arguments, but "${name}" was given.`
        : `${tool.name} has no argument "${name}". It accepts ${list(known)}.`
    }
    const schema = properties[name]
    if (!schema) continue
    const failure = checkValue(args[name], schema, `"${name}"`)
    if (failure) return failure
  }

  return null
}
