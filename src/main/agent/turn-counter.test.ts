import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentEvent } from '@shared/agent'
import { newStreamState, toAgentEvents } from './stream'
import { turnCounter, type TurnCount } from './turn-counter'

/** Two tool calls as `claude --include-partial-messages` streams them: each block's start, then the settled message. */
function streamedTurn(runId: string): AgentEvent[] {
  const state = newStreamState()
  const lines: Record<string, unknown>[] = [
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__bay__read_project', input: {} } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_2', name: 'mcp__bay__add_track', input: {} } } },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'mcp__bay__read_project', input: {} },
          { type: 'tool_use', id: 'toolu_2', name: 'mcp__bay__add_track', input: { kind: 'video' } }
        ]
      }
    }
  ]
  return [{ type: 'started', runId }, ...lines.flatMap((line) => toAgentEvents(line, runId, state)), { type: 'done', runId, reason: 'complete' }]
}

test('agent_turn counts each tool call once, though the stream announces it twice', () => {
  const events = streamedTurn('r1')
  // The specimen really does carry each call twice — otherwise this would pass whatever the counter did.
  assert.equal(events.filter((event) => event.type === 'tool').length, 4)
  const reports: TurnCount[] = []
  const count = turnCounter((report) => reports.push(report))
  for (const event of events) count(event)
  assert.deepEqual(reports, [{ toolCalls: 2, ok: true }])
})

test('turns are counted apart, and a stopped turn is not ok (positive control)', () => {
  const reports: TurnCount[] = []
  const count = turnCounter((report) => reports.push(report))
  for (const event of streamedTurn('r1')) count(event)
  count({ type: 'started', runId: 'r2' })
  count({ type: 'tool', runId: 'r2', callId: 'toolu_9', tool: 'undo', args: {} })
  count({ type: 'done', runId: 'r2', reason: 'stopped' })
  count({ type: 'started', runId: 'r3' })
  count({ type: 'done', runId: 'r3', reason: 'complete' })
  assert.deepEqual(reports, [{ toolCalls: 2, ok: true }, { toolCalls: 1, ok: false }, { toolCalls: 0, ok: true }])
})
