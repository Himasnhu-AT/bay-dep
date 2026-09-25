/**
 * `codex exec --json` output, turned into `AgentEvent`s.
 *
 * The Codex counterpart of `stream.ts`, and pure for the same reason: this is the only part of the
 * Codex runtime with logic in it, and a module that spawns a process cannot be tested under
 * `pnpm test`. The shapes were **captured from the real CLI** (codex-cli 0.149.1) — the fixtures
 * in the test are lines from actual runs — rather than read off documentation.
 *
 * What a line looks like:
 *
 *     {"type":"thread.started","thread_id":"01a0d446-…"}
 *     {"type":"turn.started"}
 *     {"type":"item.started","item":{"id":"item_2","type":"mcp_tool_call","server":"bay","tool":"list_projects",…}}
 *     {"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"…"}}
 *     {"type":"turn.completed","usage":{…}}
 *     {"type":"error","message":"You've hit your usage limit. …"}
 *     {"type":"turn.failed","error":{"message":"…"}}
 *
 * Unlike Claude's stream there are no token deltas: an agent message arrives whole when it is
 * finished, and a tool call's arguments arrive settled on `item.started`. So a Codex turn is
 * chunkier in the panel — nothing to fix here, it is what the CLI emits.
 *
 * Codex's item ids (`item_0`, `item_1`, …) restart every turn, and the panel pairs a tool card
 * with its result by id across the whole conversation. So every `callId` is the item id
 * prefixed with the turn's `runId` — without it, turn two's `item_2` would patch turn one's card.
 */

import type { AgentEvent } from '@shared/agent'
import { summarise } from './stream'

type Line = Record<string, unknown>

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** What a turn's earlier lines said that later ones depend on. One per turn. */
export interface CodexStreamState {
  /** The thread id, once `thread.started` has named it — what a later turn resumes. */
  threadId: string | null
  /**
   * The last thing emitted was prose, so the next message needs a paragraph break before it. The
   * panel appends text to an open text block and starts a new one after a tool card or a
   * thought, so only back-to-back messages would otherwise run together mid-sentence.
   */
  afterText: boolean
  /** A top-level `error` line, kept for the `turn.failed` that follows it. */
  lastError: string | null
  /** Tool calls that started and have not finished, so a completion is not shown twice. */
  openCalls: Set<string>
  /** Reasoning blocks shown as started, so the indicator can be stopped. */
  thinking: boolean
}

export function newCodexStreamState(threadId: string | null = null): CodexStreamState {
  return { threadId, afterText: false, lastError: null, openCalls: new Set(), thinking: false }
}

/**
 * The name the panel shows for a tool. bay's own tools read as noise with a server prefix, and
 * so do Codex's built-in resource readers, which it reports under server `codex`
 * (`list_mcp_resources`) — captured. Any other server keeps its prefix, because "which server" is
 * information there. (There should be no other — the config names only bay — but a card should
 * say so if one ever appears.)
 */
function toolName(item: Record<string, unknown>): string {
  const type = asString(item['type'])
  if (type === 'mcp_tool_call') {
    const server = asString(item['server']) ?? '?'
    const tool = asString(item['tool']) ?? '?'
    return server === 'bay' || server === 'codex' ? tool : `${server}.${tool}`
  }
  if (type === 'command_execution') return 'shell'
  return type ?? 'tool'
}

function toolArgs(item: Record<string, unknown>): Record<string, unknown> {
  switch (asString(item['type'])) {
    case 'mcp_tool_call':
      return asRecord(item['arguments']) ?? {}
    case 'command_execution':
      return { command: item['command'] }
    case 'file_change':
      return { changes: item['changes'] }
    case 'web_search':
      return { query: item['query'] }
    default:
      return {}
  }
}

/** Whether an item is a call the panel shows as a tool card. */
const TOOL_ITEMS = new Set(['mcp_tool_call', 'command_execution', 'file_change', 'web_search'])

function toolResult(item: Record<string, unknown>): { ok: boolean; summary: string } {
  const status = asString(item['status'])
  const type = asString(item['type'])
  if (type === 'mcp_tool_call') {
    const error = asRecord(item['error'])
    const errorText = asString(error?.['message']) ?? asString(item['error'])
    const result = asRecord(item['result'])
    const summary = errorText ?? summarise(result?.['content'])
    // `failed` covers a tool that answered with `isError` — bay's refusals — as well as one that
    // could not be reached; either way the text is the recovery instruction.
    return { ok: status === 'completed' && !errorText, summary }
  }
  if (type === 'command_execution') {
    const output = asString(item['aggregated_output']) ?? ''
    const exit = item['exit_code']
    return {
      ok: status === 'completed' && (exit === 0 || exit === undefined || exit === null),
      summary: summarise(`${output}${typeof exit === 'number' && exit !== 0 ? `\n(exit ${exit})` : ''}`.trim())
    }
  }
  return { ok: status !== 'failed' && status !== 'declined', summary: status ?? '' }
}

/** Parse one line. Nothing for a line that is not a JSON object — never throws. */
export function parseCodexLine(line: string): Line | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  try {
    return asRecord(JSON.parse(trimmed))
  } catch {
    return null
  }
}

export function codexToAgentEvents(line: Line, runId: string, state: CodexStreamState): AgentEvent[] {
  const type = asString(line['type'])

  if (type === 'thread.started') {
    state.threadId = asString(line['thread_id']) ?? state.threadId
    return []
  }

  if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
    const item = asRecord(line['item'])
    const itemType = asString(item?.['type'])
    const id = asString(item?.['id'])
    if (!item || !itemType || !id) return []
    const callId = `${runId}:${id}`
    const out: AgentEvent[] = []

    // Reasoning is its own item. Summaries arrive whole on completion, like messages.
    if (itemType === 'reasoning') {
      // The panel starts a new block after a thought, as after a tool card: no break needed.
      state.afterText = false
      if (type === 'item.started' && !state.thinking) {
        state.thinking = true
        out.push({ type: 'thinking-start', runId })
      }
      if (type === 'item.completed') {
        const text = asString(item['text'])
        if (!state.thinking) out.push({ type: 'thinking-start', runId })
        if (text) out.push({ type: 'thinking', runId, delta: text })
        out.push({ type: 'thinking-end', runId })
        state.thinking = false
      }
      return out
    }

    if (itemType === 'agent_message') {
      if (type !== 'item.completed') return []
      const text = asString(item['text'])
      if (!text) return []
      const delta = state.afterText ? `\n\n${text}` : text
      state.afterText = true
      return [{ type: 'text', runId, delta }]
    }

    if (TOOL_ITEMS.has(itemType)) {
      state.afterText = false
      if (type === 'item.started') {
        state.openCalls.add(callId)
        return [{ type: 'tool', runId, callId, tool: toolName(item), args: toolArgs(item) }]
      }
      if (type === 'item.completed') {
        // A call that completes with no start line (a file change is reported only once done)
        // still gets its card before its result.
        if (!state.openCalls.delete(callId)) {
          out.push({ type: 'tool', runId, callId, tool: toolName(item), args: toolArgs(item) })
        }
        out.push({ type: 'tool-result', runId, callId, ...toolResult(item) })
      }
      return out
    }

    // `error` items are warnings about the session ("skill descriptions were shortened"), not
    // failures of the turn — a failed turn says so with `turn.failed`. `todo_list` is the model's
    // own plan. Neither is part of the conversation the user is following.
    return []
  }

  if (type === 'error') {
    state.lastError = asString(line['message']) ?? state.lastError
    return []
  }

  if (type === 'turn.completed') {
    return [...closeThinking(runId, state), { type: 'done', runId, reason: 'complete' }]
  }

  if (type === 'turn.failed') {
    const message =
      asString(asRecord(line['error'])?.['message']) ?? state.lastError ?? 'The Codex turn failed.'
    return [...closeThinking(runId, state), { type: 'done', runId, reason: 'error', message }]
  }

  // `turn.started` and anything newer than this parser: real information about the run, none of
  // it part of the conversation.
  return []
}

function closeThinking(runId: string, state: CodexStreamState): AgentEvent[] {
  if (!state.thinking) return []
  state.thinking = false
  return [{ type: 'thinking-end', runId }]
}
