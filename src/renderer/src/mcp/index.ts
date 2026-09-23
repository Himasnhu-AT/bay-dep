/**
 * The renderer-side MCP executor: one tool call in, one result out.
 *
 * Everything a tool does goes through the existing store actions. There is deliberately no
 * second way into the project from here — if a tool needs something the store cannot do,
 * the store grows, because anything that mutates `project` outside `edit()` is a change the
 * user cannot undo and the UI may not notice.
 *
 * The dispatcher's own job is small and worth stating: find the tool, validate the
 * arguments against the catalog's schema, run it, and turn anything thrown into a message
 * an agent can act on. It never rejects — a rejected promise here becomes a timeout in
 * main, and a timeout tells the agent nothing about what went wrong.
 */

import type { McpToolCall, McpToolResult } from '@shared/mcp'
import { findTool, TOOLS } from '@shared/mcp'
import { bay } from '@/lib/bay'
import { checkApproval } from '@shared/agent'
import { store, ToolError } from './helpers'
import { browseAssets, inspectItem, readProject } from './read'
import { exportTimeline, trackExport } from './exports'
import {
  addTrack,
  deleteItems,
  editItem,
  importMedia,
  placeAsset,
  removeRange,
  setPlayhead,
  splitAt,
  undo
} from './write'
import { previewFrame } from './preview'
import { readComposition, writeComposition } from './compositions'
import { addTemplate } from './templates'
import { addTransition, removeTransition } from './transitions'
import { validateArgs } from '@shared/validate'
import { proposeEdit } from './proposals'
import { trimItem } from './trim'

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>

const HANDLERS: Record<string, Handler> = {
  read_project: () => readProject(),
  browse_assets: () => browseAssets(),
  inspect_item: (args) => inspectItem(args),
  preview_frame: (args) => previewFrame(args),
  propose_edit: (args) => proposeEdit(args),
  import_media: (args) => importMedia(args),
  write_composition: (args) => writeComposition(args),
  read_composition: (args) => readComposition(args),
  add_template: (args) => addTemplate(args),
  place_asset: (args) => placeAsset(args),
  edit_item: (args) => editItem(args),
  trim_item: (args) => trimItem(args),
  split_at: (args) => splitAt(args),
  delete_items: (args) => deleteItems(args),
  remove_range: (args) => removeRange(args),
  add_track: (args) => addTrack(args),
  add_transition: (args) => addTransition(args),
  remove_transition: (args) => removeTransition(args),
  set_playhead: (args) => setPlayhead(args),
  undo: () => undo(),
  export_timeline: (args) => exportTimeline(args),
  track_export: (args) => trackExport(args)
}

/**
 * Every tool in the catalog has a handler, and every handler is in the catalog.
 *
 * This is a real guard and it has already earned its place — it caught `add_transition` and
 * `remove_transition` reaching the catalog with nothing behind them. But it used to `throw`
 * at module scope, and that was the wrong severity by a wide margin: the throw took the
 * whole renderer down, so a catalog mismatch cost a user who has never touched MCP their
 * entire editor. The blast radius was larger than the bug.
 *
 * So it reports loudly and lets the app live. The mismatch still cannot ship quietly:
 * `test/app/mcp.mjs` asserts every catalog tool answers, and the dispatcher below refuses an
 * unimplemented one with a message that names it as a build fault rather than a bad call, so
 * an agent stops rewriting arguments against something that was never going to work.
 */
const missing = TOOLS.filter((tool) => !HANDLERS[tool.name]).map((t) => t.name)
const extra = Object.keys(HANDLERS).filter((name) => !findTool(name))

/**
 * The mismatch as a value, so the status bar can say it out loud — `null` when the two agree.
 *
 * A `console.error` is only loud to whoever has devtools open, and the person who most needs
 * to know is the one driving bay from an agent and wondering why a tool keeps refusing. This
 * is the same treatment `storageReady` and `mediaToolsReady` get, for the same reason: a
 * subsystem that is broken and one that is merely idle look identical from outside.
 */
export const catalogMismatch: { missing: string[]; extra: string[] } | null =
  missing.length > 0 || extra.length > 0 ? { missing, extra } : null

if (catalogMismatch) {
  console.error(
    '[bay] The MCP catalog and the executor disagree.' +
      (missing.length > 0 ? ` Listed but not implemented: ${missing.join(', ')}.` : '') +
      (extra.length > 0 ? ` Implemented but not listed: ${extra.join(', ')}.` : '')
  )
}

export async function executeToolCall(call: McpToolCall): Promise<McpToolResult> {
  const tool = findTool(call.tool)
  if (!tool) {
    return {
      id: call.id,
      ok: false,
      error:
        `There is no tool called "${call.tool}". Available: ` +
        `${TOOLS.map((t) => t.name).join(', ')}.`
    }
  }

  const handler = HANDLERS[tool.name]
  if (!handler) {
    return {
      id: call.id,
      ok: false,
      error:
        `${call.tool} is listed in this build's catalog but has no implementation behind it. ` +
        `That is a fault in bay, not in the call — no arguments will make it work. Do not ` +
        `retry it, and do not plan the rest of the edit around it.`
    }
  }

  const args = call.args ?? {}
  const invalid = validateArgs(tool, args)
  if (invalid) return { id: call.id, ok: false, error: invalid }

  // The approval gate, and it sits here rather than in each write tool for the same reason the
  // catalog does: thirty handlers is thirty places to forget, and the one that forgot would be
  // the one nobody noticed. `null` means no in-app agent session is driving — bay answering
  // the socket, where the person is in a terminal watching every call — and then nothing is
  // gated at all.
  //
  // Checked *before* the handler and consumed *after* it succeeds. A call that threw changed
  // nothing, so spending the approval on it would block the retry its own error message asks
  // for; `edit()` returning unchanged when a mutator declines is what makes that safe to
  // assume rather than hope.
  const verdict = checkApproval(tool.name, args, store().agentGate)
  if (!verdict.allowed) {
    return { id: call.id, ok: false, error: verdict.refusal ?? 'That edit is not approved.' }
  }

  try {
    const value = await handler(args)
    if (verdict.index !== undefined) store().consumeApproval(verdict.index)
    return { id: call.id, ok: true, value }
  } catch (error) {
    if (error instanceof ToolError) return { id: call.id, ok: false, error: error.message }
    // An unexpected throw is a bug here, not a mistake by the agent. Say so, so it stops
    // rewriting its arguments against something that was never going to work.
    const message = error instanceof Error ? error.message : String(error)
    return {
      id: call.id,
      ok: false,
      error: `${call.tool} failed unexpectedly inside bay: ${message}. This is a fault in the editor, not in the call — the same arguments will not work on a retry.`
    }
  }
}

/**
 * The probe seam, gated exactly like the engine's `window.bayEngine`.
 *
 * Nothing inside the bundle is reachable from outside it, so measuring the executor needs a
 * handle a debugger can find. It is deliberately *not* the transport: driving tool calls
 * straight into the dispatcher separates a fault here from a fault in main's socket, which
 * is the difference between a bug report someone can act on and "MCP is broken".
 *
 * Off unless asked for — a handle that lets arbitrary page script rewrite the project should
 * not exist in a release build merely because the page is local today.
 *
 *     localStorage.setItem('bay.debug', '1')   // then reload
 */
const DEBUG_FLAG = 'bay.debug'

function probeSurfaceEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_FLAG) === '1'
  } catch {
    return false
  }
}

/**
 * Registers the executor with the bridge. Returns an unsubscribe function, or a no-op when
 * there is no bridge — a window without one simply has no agent surface, which is not an
 * error worth surfacing to the user.
 */
export function registerMcpExecutor(): () => void {
  if (probeSurfaceEnabled()) {
    ;(window as Window & { bayMcp?: unknown }).bayMcp = { execute: executeToolCall, tools: TOOLS }
  }
  const api = bay()
  // `mcp` arrives with the transport; a build whose preload predates it still runs, it just
  // has no agent surface.
  if (!api?.mcp) return () => {}
  return api.mcp.onToolCall(executeToolCall)
}
