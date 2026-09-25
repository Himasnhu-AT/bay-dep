/**
 * Claude Code's `stream-json` output, turned into `AgentEvent`s.
 *
 * Separated from the process that produces it for the usual reason: this is the only part with
 * logic in it, and a module that spawns a subprocess cannot be tested under `pnpm test`. The
 * shapes below were **captured from the real CLI** (2.1.267) rather than read off documentation
 * — the fixtures in the test file are lines from an actual run, so a format change breaks a
 * test instead of breaking a panel.
 *
 * The stream carries far more than a panel needs: rate-limit envelopes, per-model cost
 * accounting, subagent statistics, cache-token breakdowns. Everything unrecognised is dropped
 * rather than surfaced, and dropping is deliberate — a chat panel that renders whatever arrives
 * becomes a log viewer, and the one thing the user is trying to follow gets buried.
 */

import type { AgentEvent } from '@shared/agent'

/** One line of the stream, already JSON-parsed. Shapes are checked, never assumed. */
type StreamMessage = Record<string, unknown>

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * Parse one line. Returns nothing for a line that is not JSON at all.
 *
 * The CLI writes diagnostics to stderr, but a malformed line on stdout has happened before in
 * tools of this shape, and a parser that throws takes the whole conversation down over one bad
 * byte. A line we cannot read is a line we ignore.
 */
export function parseLine(line: string): StreamMessage | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  try {
    return asRecord(JSON.parse(trimmed))
  } catch {
    return null
  }
}

/**
 * `mcp__bay__edit_item` is bay's own tool and reads as noise with the prefix on. Other servers
 * keep theirs, because "which server" is information the user needs there.
 */
function shortToolName(tool: string): string {
  return tool.startsWith('mcp__bay__') ? tool.slice('mcp__bay__'.length) : tool
}

/**
 * What one stream message means for the panel.
 *
 * Returns an array because a single `assistant` message can carry several content blocks, and
 * because most messages mean nothing at all and return none.
 */
/**
 * What a run's stream has said so far that later messages depend on: which tool call each
 * content block index belongs to. An `input_json_delta` names only its block index, so without
 * this its fragment could not be put on the right card. One per run.
 */
export interface StreamState {
  toolBlocks: Map<number, string>
  /** Open thinking blocks, by index, so their stop can end the "thinking" indicator. */
  thinkingBlocks: Set<number>
}

export function newStreamState(): StreamState {
  return { toolBlocks: new Map(), thinkingBlocks: new Set() }
}

export function toAgentEvents(message: StreamMessage, runId: string, state: StreamState = newStreamState()): AgentEvent[] {
  const type = asString(message['type'])

  // Streaming deltas: the only path that produces anything while the model is still writing.
  if (type === 'stream_event') {
    const event = asRecord(message['event'])
    if (!event) return []
    const eventType = asString(event['type'])

    // A thinking block ending: the indicator stops.
    if (eventType === 'content_block_stop') {
      const index = event['index']
      if (typeof index === 'number' && state.thinkingBlocks.delete(index)) return [{ type: 'thinking-end', runId }]
      return []
    }

    // A tool call starting: show its card now, not when its whole input has arrived.
    if (eventType === 'content_block_start') {
      const block = asRecord(event['content_block'])
      const index = event['index']
      // A thinking block starting: its text never arrives (display "omitted"), so say it began.
      if (asString(block?.['type']) === 'thinking' && typeof index === 'number') {
        state.thinkingBlocks.add(index)
        return [{ type: 'thinking-start', runId }]
      }
      const callId = asString(block?.['id'])
      const tool = asString(block?.['name'])
      if (asString(block?.['type']) !== 'tool_use' || !callId || !tool || typeof index !== 'number') return []
      state.toolBlocks.set(index, callId)
      return [{ type: 'tool', runId, callId, tool: shortToolName(tool), args: {} }]
    }

    if (eventType === 'content_block_delta') {
      const delta = asRecord(event['delta'])
      const deltaType = asString(delta?.['type'])
      const text = asString(delta?.['text'])
      if (deltaType === 'text_delta' && text) return [{ type: 'text', runId, delta: text }]
      const partial = asString(delta?.['partial_json'])
      const index = event['index']
      if (deltaType === 'input_json_delta' && partial && typeof index === 'number') {
        const callId = state.toolBlocks.get(index)
        return callId ? [{ type: 'tool-input', runId, callId, delta: partial }] : []
      }
      // Thinking arrives as its own delta type and is kept separate: a setting that hides
      // reasoning must not also hide the answer.
      const thinking = asString(delta?.['thinking'])
      if (deltaType === 'thinking_delta' && thinking) {
        return [{ type: 'thinking', runId, delta: thinking }]
      }
      return []
    }
    return []
  }

  // The settled assistant message. Text here has already been streamed as deltas, so only the
  // tool calls are new — emitting the text again would double it in the panel.
  if (type === 'assistant') {
    const content = asRecord(message['message'])?.['content']
    if (!Array.isArray(content)) return []
    const out: AgentEvent[] = []
    for (const raw of content) {
      const block = asRecord(raw)
      if (asString(block?.['type']) !== 'tool_use') continue
      const callId = asString(block?.['id'])
      const tool = asString(block?.['name'])
      if (!callId || !tool) continue
      out.push({
        type: 'tool',
        runId,
        callId,
        tool: shortToolName(tool),
        args: asRecord(block?.['input']) ?? {}
      })
    }
    return out
  }

  // Tool results come back as a `user` message — the transcript's view, not the panel's.
  if (type === 'user') {
    const content = asRecord(message['message'])?.['content']
    if (!Array.isArray(content)) return []
    const out: AgentEvent[] = []
    for (const raw of content) {
      const block = asRecord(raw)
      if (asString(block?.['type']) !== 'tool_result') continue
      const callId = asString(block?.['tool_use_id'])
      if (!callId) continue
      out.push({
        type: 'tool-result',
        runId,
        callId,
        ok: block?.['is_error'] !== true,
        summary: summarise(block?.['content'])
      })
    }
    return out
  }

  if (type === 'result') {
    const subtype = asString(message['subtype'])
    const isError = message['is_error'] === true
    return [
      {
        type: 'done',
        runId,
        reason: isError ? 'error' : 'complete',
        ...(isError ? { message: failureText(message) ?? subtype ?? 'The run failed.' } : {})
      }
    ]
  }

  // Everything else — `system`/init, `system`/status, `rate_limit_event` — is real information
  // about the run and none of it belongs in a conversation the user is reading.
  return []
}

/**
 * Why a run failed, in the words the run itself used.
 *
 * Error results do not carry `result` — the error subtypes (`error_during_execution`,
 * `error_max_turns`, …) put their reasons in an `errors` array instead, which is the shape the
 * Agent SDK types declare for them. Reading only `result` reduced every such failure to its
 * subtype name, which tells the user a category and not a cause.
 */
function failureText(message: StreamMessage): string | null {
  const result = asString(message['result'])
  if (result) return result
  const errors = message['errors']
  if (Array.isArray(errors)) {
    const text = errors.filter((e): e is string => typeof e === 'string' && e.length > 0)
    if (text.length > 0) return text.join('\n')
  }
  return null
}

/**
 * A tool result as one readable string.
 *
 * Refusals in this codebase are recovery instructions, so the text is kept rather than
 * collapsed into a status: the whole point of writing "call read_project and copy an id from
 * its output" is that somebody reads it. Truncated only far past the length of any refusal bay
 * actually produces.
 */
const MAX_SUMMARY = 2000

export function summarise(content: unknown): string {
  if (typeof content === 'string') return clamp(content)
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const raw of content) {
      const block = asRecord(raw)
      const text = asString(block?.['text'])
      if (text) parts.push(text)
    }
    return clamp(parts.join('\n'))
  }
  return ''
}

function clamp(text: string): string {
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text
}
