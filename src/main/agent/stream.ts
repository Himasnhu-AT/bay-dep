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
 * What one stream message means for the panel.
 *
 * Returns an array because a single `assistant` message can carry several content blocks, and
 * because most messages mean nothing at all and return none.
 */
export function toAgentEvents(message: StreamMessage, runId: string): AgentEvent[] {
  const type = asString(message['type'])

  // Streaming deltas: the only path that produces text while the model is still writing.
  if (type === 'stream_event') {
    const event = asRecord(message['event'])
    if (!event) return []
    const eventType = asString(event['type'])

    if (eventType === 'content_block_delta') {
      const delta = asRecord(event['delta'])
      const deltaType = asString(delta?.['type'])
      const text = asString(delta?.['text'])
      if (deltaType === 'text_delta' && text) return [{ type: 'text', runId, delta: text }]
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
        // `mcp__bay__edit_item` is bay's own tool and reads as noise with the prefix on. Other
        // servers keep theirs, because "which server" is information the user needs there.
        tool: tool.startsWith('mcp__bay__') ? tool.slice('mcp__bay__'.length) : tool,
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
        ...(isError
          ? { message: asString(message['result']) ?? subtype ?? 'The run failed.' }
          : {})
      }
    ]
  }

  // Everything else — `system`/init, `system`/status, `rate_limit_event` — is real information
  // about the run and none of it belongs in a conversation the user is reading.
  return []
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

function summarise(content: unknown): string {
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
