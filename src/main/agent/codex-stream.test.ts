/**
 * `codex exec --json` → `AgentEvent`s, against lines captured from the real CLI (codex-cli
 * 0.149.1). The files in `fixtures/codex/` are whole runs, byte for byte — including the noise
 * (`error` items that are warnings, `turn.started`, usage) — so a format change breaks a test
 * rather than a panel.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '@shared/agent'
import { codexToAgentEvents, newCodexStreamState, parseCodexLine, type CodexStreamState } from './codex-stream'

const RUN = 'run-1'

function fixture(name: string): string[] {
  return readFileSync(join(import.meta.dirname, 'fixtures', 'codex', `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
}

function play(lines: string[], state: CodexStreamState = newCodexStreamState(), runId = RUN): AgentEvent[] {
  const events: AgentEvent[] = []
  for (const line of lines) {
    const message = parseCodexLine(line)
    if (message) events.push(...codexToAgentEvents(message, runId, state))
  }
  return events
}

const ofType = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) =>
  events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type)

test('a bay tool call becomes a card with its short name, then its result', () => {
  const events = play(fixture('tools-and-reasoning'))
  const calls = ofType(events, 'tool')
  const listProjects = calls.find((call) => call.tool === 'list_projects')
  assert.ok(listProjects, 'the list_projects call is shown')
  assert.deepEqual(listProjects.args, {})
  const result = ofType(events, 'tool-result').find((r) => r.callId === listProjects.callId)
  assert.equal(result?.ok, true)
  assert.match(result?.summary ?? '', /Stub Project/)
})

test('a card appears before its result, once, even when calls finish out of order', () => {
  // In the capture, item_5 and item_6 start together and item_6 finishes first.
  const events = play(fixture('tools-and-reasoning'))
  const seen = new Set<string>()
  for (const event of events) {
    if (event.type === 'tool') {
      assert.ok(!seen.has(event.callId), `card for ${event.callId} emitted twice`)
      seen.add(event.callId)
    }
    if (event.type === 'tool-result') assert.ok(seen.has(event.callId), `result for ${event.callId} before its card`)
  }
  assert.ok(ofType(events, 'tool').some((call) => call.tool === 'list_mcp_resources'), 'Codex’s resource reader is named plainly')
})

test('a refused bay call is a failed result carrying bay’s own words', () => {
  // `status: "failed"` with the refusal in `result.content`, and in another capture the reason in
  // `error.message` with no result at all. Both are the recovery instruction the user should read.
  const refused = ofType(play(fixture('tool-refused')), 'tool-result')
  assert.equal(refused.length, 1)
  assert.equal(refused[0]!.ok, false)
  assert.match(refused[0]!.summary, /"list_projects" was not applied\. No agent socket appeared/)

  const errored = ofType(play(fixture('tools-and-reasoning')), 'tool-result').filter((r) => !r.ok)
  assert.equal(errored.length, 1)
  assert.match(errored[0]!.summary, /No resource at .*bay serves: bay:\/\/guide\/editing/)
})

test('agent messages are text, whole; warning items are not shown', () => {
  const events = play(fixture('tool-refused'))
  // A tool card sits between the two messages, so the panel shows them as two blocks already.
  assert.deepEqual(
    ofType(events, 'text').map((event) => event.delta.slice(0, 30)),
    ['I’ll call the Bay `list_projec', 'The Bay `list_projects` call r']
  )
  // `item_0` is `{"type":"error","message":"Skill descriptions were shortened…"}` — a warning.
  assert.ok(!JSON.stringify(events).includes('Skill descriptions were shortened'))
})

test('back-to-back messages get a paragraph break, or they run together in one block', () => {
  const events = play([
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"First."}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Second."}}'
  ])
  assert.equal(ofType(events, 'text').map((event) => event.delta).join(''), 'First.\n\nSecond.')
})

test('a message after a thought starts its own block, with no stray break in front', () => {
  // The capture: a message, four reasoning items, then the answer.
  const texts = ofType(play(fixture('sandbox-probe')), 'text')
  assert.equal(texts.length, 2)
  assert.ok(texts[1]!.delta.startsWith('Literal results:'))
})

test('reasoning summaries are thinking, opened and closed', () => {
  const events = play(fixture('tools-and-reasoning'))
  const thinking = ofType(events, 'thinking').map((event) => event.delta)
  assert.ok(thinking.includes('**Accessing guessed project list function**'))
  assert.equal(ofType(events, 'thinking-start').length, ofType(events, 'thinking-end').length)
  assert.ok(!ofType(events, 'text').some((event) => event.delta.includes('Accessing guessed')), 'reasoning is not answer text')
})

test('a finished turn is done/complete, and the thread id is kept for the next turn', () => {
  const state = newCodexStreamState()
  const events = play(fixture('tools-and-reasoning'), state)
  assert.deepEqual(events.at(-1), { type: 'done', runId: RUN, reason: 'complete' })
  assert.equal(ofType(events, 'done').length, 1)
  assert.equal(state.threadId, '01a0d61e-57b1-7403-8a09-1fc0ff6cd1d0')
})

test('a resumed turn names the same thread and answers from the earlier turn’s context', () => {
  const state = newCodexStreamState('01a0d61c-0203-74b3-9014-1f5f13cef74f')
  const events = play(fixture('resumed'), state)
  assert.equal(state.threadId, '01a0d61c-0203-74b3-9014-1f5f13cef74f')
  assert.deepEqual(ofType(events, 'text').map((event) => event.delta), ['Stub'])
  assert.equal(events.at(-1)?.type, 'done')
})

test('a failed turn is done/error with Codex’s own reason, not a generic one', () => {
  const events = play(fixture('usage-limit'))
  const done = ofType(events, 'done')
  assert.equal(done.length, 1)
  assert.equal(done[0]!.reason, 'error')
  assert.match(done[0]!.message ?? '', /^You've hit your usage limit\./)
})

test('a failed turn with no message of its own falls back to the error line before it', () => {
  const state = newCodexStreamState()
  const events = play(['{"type":"error","message":"stream disconnected"}', '{"type":"turn.failed","error":{}}'], state)
  assert.deepEqual(events, [{ type: 'done', runId: RUN, reason: 'error', message: 'stream disconnected' }])
})

test('item ids repeat every turn, so call ids are scoped to the turn', () => {
  // Every turn numbers its items from item_0; the panel pairs cards and results by id across the
  // whole conversation.
  const first = ofType(play(fixture('tool-refused'), newCodexStreamState(), 'turn-a'), 'tool')
  const second = ofType(play(fixture('tool-refused'), newCodexStreamState(), 'turn-b'), 'tool')
  assert.equal(first[0]!.callId.endsWith('item_2') && second[0]!.callId.endsWith('item_2'), true)
  assert.notEqual(first[0]!.callId, second[0]!.callId)
})

test('a line that is not JSON is ignored rather than ending the conversation', () => {
  assert.equal(parseCodexLine('Reading additional input from stdin...'), null)
  assert.equal(parseCodexLine(''), null)
  assert.equal(parseCodexLine('[1,2]'), null)
})

test('the sandbox probe: every escape attempt ended in text, never a shell card', () => {
  // The adversarial run behind CLAUDE.md's Codex sandbox paragraph. Its escapes ran inside
  // `exec` and `apply_patch`, which --json does not report as items — the refusals are in the
  // final message, which is what the panel shows.
  const events = play(fixture('sandbox-probe'))
  assert.equal(ofType(events, 'tool').filter((call) => call.tool === 'shell').length, 0)
  const text = ofType(events, 'text').map((event) => event.delta).join('')
  assert.match(text, /patch rejected: writing is blocked by read-only sandbox/)
  assert.match(text, /process is not defined/)
})
