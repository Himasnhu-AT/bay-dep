/**
 * A person's click running an agent tool's own implementation.
 *
 * The code editor's Apply, "New motion graphic" and the Subtitles panel's Apply do exactly what
 * `write_brf`, `write_composition` and `add_subtitles` do, so they call those handlers — one
 * implementation. They must not go through `executeToolCall`, which is the *agent's* entry point:
 * it checks the "Ask before editing" gate (so a person's own Apply was refused with the agent's
 * "propose it first" message) and wraps the edit in `asAgent` (so it landed on the turn's Changes
 * card as the agent's work, and that card's Revert took it back without saying it was the user's).
 *
 * What is kept from the executor: the catalog's argument validation, and a result that never
 * rejects, so a busy button always clears.
 */

import { findTool } from '@shared/mcp'
import { validateArgs } from '@shared/validate'
import type { Handler } from '@/mcp/helpers'

export type UserToolResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string }

export async function runUserTool(
  toolName: string,
  handler: Handler,
  args: Record<string, unknown>
): Promise<UserToolResult> {
  const tool = findTool(toolName)
  if (!tool) return { ok: false, error: `${toolName} is not a tool bay knows.` }
  const invalid = validateArgs(tool, args)
  if (invalid) return { ok: false, error: invalid }
  try {
    const value = await handler(args)
    return { ok: true, value: (value ?? {}) as Record<string, unknown> }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
