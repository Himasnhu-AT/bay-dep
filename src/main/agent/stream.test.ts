/**
 * The `stream-json` parser, against lines captured from the real CLI.
 *
 * Every fixture here is a line Claude Code 2.1.267 actually wrote, trimmed of the fields the
 * parser never reads. That matters more than usual: this format is not a contract bay owns, and
 * a hand-invented fixture would test my idea of the format rather than the format. If the CLI
 * changes shape, these fail — which is the earliest anyone could find out.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newStreamState, parseLine, toAgentEvents } from './stream'

const RUN = 'run_1'
const events = (line: string) => {
  const message = parseLine(line)
  assert.ok(message, `line did not parse: ${line.slice(0, 80)}`)
  return toAgentEvents(message, RUN)
}

// --- lines that carry nothing a reader wants ----------------------------------------------

test('the init envelope produces no conversation events', () => {
  // Real line, heavily trimmed. It carries the tool list, mcp server states, model, slash
  // commands and the session id — all real information about the run, none of it something to
  // put in a chat panel.
  const line = JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: '70e724a7',
    tools: ['Read', 'Write'],
    mcp_servers: [{ name: 'bay', status: 'connected' }],
    model: 'claude-opus-5[1m]'
  })
  assert.deepEqual(events(line), [])
})

test('rate-limit and status envelopes produce nothing', () => {
  assert.deepEqual(
    events(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })),
    []
  )
  assert.deepEqual(
    events(JSON.stringify({ type: 'system', subtype: 'status', status: 'requesting' })),
    []
  )
})

test('an unparseable line is ignored rather than thrown', () => {
  // A parser that throws takes the whole conversation down over one bad byte.
  assert.equal(parseLine('not json at all'), null)
  assert.equal(parseLine(''), null)
  assert.equal(parseLine('   '), null)
  // A JSON scalar is valid JSON and still not a message.
  assert.equal(parseLine('42'), null)
})

// --- text ----------------------------------------------------------------------------------

test('a text delta becomes one text event', () => {
  const line = JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello from bay' }
    }
  })
  assert.deepEqual(events(line), [{ type: 'text', runId: RUN, delta: 'hello from bay' }])
})

test('thinking is its own event, not text', () => {
  // Kept separate so a setting that hides reasoning cannot also hide the answer.
  const line = JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'weighing' } }
  })
  assert.deepEqual(events(line), [{ type: 'thinking', runId: RUN, delta: 'weighing' }])
})

test('the settled assistant message does NOT re-emit its text', () => {
  // The guard against every reply appearing twice: this arrives after the deltas that already
  // carried the same words.
  const line = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'hello from bay' }] }
  })
  assert.deepEqual(events(line), [])
})

// --- tool calls ----------------------------------------------------------------------------

test('a tool_use block becomes a tool event with its arguments', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Trimming the opening.' },
        {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'mcp__bay__remove_range',
          input: { fromFrame: 300, toFrame: 750 }
        }
      ]
    }
  })
  assert.deepEqual(events(line), [
    {
      type: 'tool',
      runId: RUN,
      callId: 'toolu_01',
      tool: 'remove_range',
      args: { fromFrame: 300, toFrame: 750 }
    }
  ])
})

test("bay's own prefix is stripped, another server's is kept", () => {
  // `mcp__bay__edit_item` reads as noise with the prefix on. For any other server, *which*
  // server is information the reader needs.
  const call = (name: string) =>
    events(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name, input: {} }] }
      })
    )[0]
  assert.equal((call('mcp__bay__edit_item') as { tool: string }).tool, 'edit_item')
  assert.equal((call('mcp__other__thing') as { tool: string }).tool, 'mcp__other__thing')
  assert.equal((call('Read') as { tool: string }).tool, 'Read')
})

test('several tool calls in one message all come through, in order', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'a', name: 'mcp__bay__split_at', input: { frame: 10 } },
        { type: 'tool_use', id: 'b', name: 'mcp__bay__split_at', input: { frame: 20 } }
      ]
    }
  })
  assert.deepEqual(events(line).map((e) => (e as { callId: string }).callId), ['a', 'b'])
})

test('a tool_use missing its id or name is dropped rather than half-rendered', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', input: {} }, { type: 'tool_use', id: 'x' }] }
  })
  assert.deepEqual(events(line), [])
})

// --- tool results --------------------------------------------------------------------------

test('a tool result pairs with its call and keeps its text', () => {
  const line = JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01',
          content: [{ type: 'text', text: '{"removedFrames":450}' }]
        }
      ]
    }
  })
  assert.deepEqual(events(line), [
    { type: 'tool-result', runId: RUN, callId: 'toolu_01', ok: true, summary: '{"removedFrames":450}' }
  ])
})

test('a refusal keeps its whole message, because it is the recovery instruction', () => {
  // The one thing that must not be collapsed into a red icon. bay's refusals name the ids to
  // use, the range that is occupied, the tracks left behind — all of it useless if summarised.
  const refusal =
    'No id starting with "nope" exists here. Ids are not guessable — call read_project and ' +
    'copy one from its output.'
  const line = JSON.stringify({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: refusal }]
    }
  })
  const [event] = events(line)
  assert.equal((event as { ok: boolean }).ok, false)
  assert.equal((event as { summary: string }).summary, refusal)
})

test('an enormous result is clamped, but far past any real refusal', () => {
  const huge = 'x'.repeat(5000)
  const line = JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: huge }] }
  })
  const summary = (events(line)[0] as { summary: string }).summary
  assert.ok(summary.length < huge.length)
  assert.ok(summary.length > 1500, 'a real refusal must never be truncated')
  assert.ok(summary.endsWith('…'), 'truncation must be visible')
})

// --- the end ---------------------------------------------------------------------------------

test('a successful result ends the run', () => {
  const line = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'hello from bay',
    total_cost_usd: 0.15
  })
  assert.deepEqual(events(line), [{ type: 'done', runId: RUN, reason: 'complete' }])
})

test('a result carries the turn’s tokens and cost, with every input part counted', () => {
  // Captured from claude 2.1.282 (`claude -p … --output-format stream-json`), trimmed to the
  // fields that matter. The three input parts are reported apart and summed; the cache-read part
  // is also kept on its own.
  const line = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Hi! 👋 How can I help you today?',
    total_cost_usd: 0.014166,
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 6653,
      cache_read_input_tokens: 2000,
      output_tokens: 170,
      output_tokens_details: { thinking_tokens: 151 },
      service_tier: 'standard'
    }
  })
  assert.deepEqual(events(line), [
    {
      type: 'done',
      runId: RUN,
      reason: 'complete',
      usage: { inputTokens: 8663, cachedInputTokens: 2000, outputTokens: 170, costUsd: 0.014166 }
    }
  ])
})

test('a failed turn still reports what it cost', () => {
  const line = JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['boom'],
    usage: { input_tokens: 5, output_tokens: 1 }
  })
  const [event] = events(line)
  assert.deepEqual((event as { usage: unknown }).usage, { inputTokens: 5, cachedInputTokens: 0, outputTokens: 1 })
})

test('a failed result ends the run as an error, carrying the reason', () => {
  const line = JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'the model refused'
  })
  const [event] = events(line)
  assert.equal((event as { reason: string }).reason, 'error')
  assert.equal((event as { message: string }).message, 'the model refused')
})

test('a failed result with no text still says something', () => {
  // A "done" with an empty message reads as a successful turn that produced nothing.
  const line = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true })
  const [event] = events(line)
  assert.equal((event as { message: string }).message, 'error_max_turns')
})

test('a failed result carries its errors when it has no result text', () => {
  // The error subtypes put their reasons in `errors`, not `result` — the shape the Agent SDK
  // declares for `SDKResultError`. Reading only `result` reported the subtype name instead.
  const line = JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['MCP server "bay" failed to start', 'no tools available']
  })
  const [event] = events(line)
  assert.equal((event as { reason: string }).reason, 'error')
  assert.equal(
    (event as { message: string }).message,
    'MCP server "bay" failed to start\nno tools available'
  )
})

test('a tool call shows as soon as it starts, and its input streams onto the same card', () => {
  const state = newStreamState()
  const start = toAgentEvents(
    { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__bay__write_composition', input: {} } } },
    'r1',
    state
  )
  assert.deepEqual(start, [{ type: 'tool', runId: 'r1', callId: 'toolu_1', tool: 'write_composition', args: {} }])
  const fragment = toAgentEvents(
    { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"/p/a.ht' } } },
    'r1',
    state
  )
  assert.deepEqual(fragment, [{ type: 'tool-input', runId: 'r1', callId: 'toolu_1', delta: '{"path":"/p/a.ht' }])
  // A fragment for a block that was never a tool call (text is index 0) is not guessed onto one.
  const stray = toAgentEvents(
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } } },
    'r1',
    state
  )
  assert.deepEqual(stray, [])
})

test('a thinking block says when it starts and when it stops, though its text is empty', () => {
  const state = newStreamState()
  const ev = (event: Record<string, unknown>) => toAgentEvents({ type: 'stream_event', event }, 'r1', state)
  assert.deepEqual(ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }), [{ type: 'thinking-start', runId: 'r1' }])
  assert.deepEqual(ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }), [], 'empty deltas stay silent')
  // Control: a text block's stop is not a thinking stop.
  assert.deepEqual(ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }), [])
  assert.deepEqual(ev({ type: 'content_block_stop', index: 1 }), [])
  assert.deepEqual(ev({ type: 'content_block_stop', index: 0 }), [{ type: 'thinking-end', runId: 'r1' }])
  assert.deepEqual(ev({ type: 'content_block_stop', index: 0 }), [], 'only once')
})
