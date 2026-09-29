/**
 * The contract's limits, each at its edge: the last value accepted beside the first refused, so a
 * check that refused everything (or nothing) cannot pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_CRASH_MESSAGE,
  MAX_CRASH_STACK,
  MAX_EVENTS_PER_BATCH,
  MAX_PROPS,
  MAX_PROP_STRING,
  RENDERER_EVENTS,
  TELEMETRY_EVENTS,
  crashReportProblem,
  sanitizeEvent,
  telemetryBatchProblem,
  type CrashReport,
  type TelemetryBatch
} from './telemetry'

const envelope = {
  v: 1 as const,
  installId: '3b241101-e2bb-4255-8caf-4136c566a962',
  appVersion: '0.9.0',
  os: 'darwin' as const,
  osVersion: '15.6.0',
  arch: 'arm64'
}

const batch = (events: TelemetryBatch['events']): TelemetryBatch => ({ ...envelope, events })
const event = (overrides: Partial<TelemetryBatch['events'][number]> = {}) => ({ name: 'app_open', at: 1_700_000_000_000, ...overrides })
const crash = (overrides: Partial<CrashReport> = {}): CrashReport => ({ ...envelope, at: 1_700_000_000_000, process: 'main', kind: 'exception', message: 'TypeError: x', ...overrides })

test('a well-formed batch and crash pass (positive control)', () => {
  assert.equal(telemetryBatchProblem(batch([event({ props: { launchMs: 900 } })])), null)
  assert.equal(crashReportProblem(crash({ stack: 'at f (index.js:1:1)', reason: 'crashed', exitCode: 11 })), null)
})

test('events: 1 to 100 per batch', () => {
  assert.match(telemetryBatchProblem(batch([])) ?? '', /1–100/)
  assert.equal(telemetryBatchProblem(batch(Array.from({ length: MAX_EVENTS_PER_BATCH }, () => event()))), null)
  assert.match(telemetryBatchProblem(batch(Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => event()))) ?? '', /1–100/)
})

test('event names: [a-z0-9_.], at most 64', () => {
  assert.equal(telemetryBatchProblem(batch([event({ name: 'a'.repeat(64) })])), null)
  assert.match(telemetryBatchProblem(batch([event({ name: 'a'.repeat(65) })])) ?? '', /name/)
  assert.match(telemetryBatchProblem(batch([event({ name: 'App Open' })])) ?? '', /name/)
})

test('props: at most 20 keys, strings at most 200', () => {
  const props = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]))
  assert.equal(telemetryBatchProblem(batch([event({ props: props(MAX_PROPS) })])), null)
  assert.match(telemetryBatchProblem(batch([event({ props: props(MAX_PROPS + 1) })])) ?? '', /at most 20/)
  assert.equal(telemetryBatchProblem(batch([event({ props: { s: 'x'.repeat(MAX_PROP_STRING) } })])), null)
  assert.match(telemetryBatchProblem(batch([event({ props: { s: 'x'.repeat(MAX_PROP_STRING + 1) } })])) ?? '', /longer than 200/)
})

test('the envelope: v 1, a UUID v4 install id, os darwin', () => {
  assert.match(telemetryBatchProblem({ ...batch([event()]), v: 2 }) ?? '', /v must be 1/)
  assert.match(telemetryBatchProblem({ ...batch([event()]), installId: 'alice@example.com' }) ?? '', /UUID v4/)
  // A v1 (time-based) UUID is derived from the machine and the clock: not what the contract allows.
  assert.match(telemetryBatchProblem({ ...batch([event()]), installId: 'c232ab00-9414-11ec-b3c8-9f6bdeced846' }) ?? '', /UUID v4/)
  assert.match(telemetryBatchProblem({ ...batch([event()]), os: 'linux' }) ?? '', /darwin/)
})

test('crash: message at most 2000, stack at most 16000, known process and kind', () => {
  assert.equal(crashReportProblem(crash({ message: 'x'.repeat(MAX_CRASH_MESSAGE) })), null)
  assert.match(crashReportProblem(crash({ message: 'x'.repeat(MAX_CRASH_MESSAGE + 1) })) ?? '', /message/)
  assert.equal(crashReportProblem(crash({ stack: 'x'.repeat(MAX_CRASH_STACK) })), null)
  assert.match(crashReportProblem(crash({ stack: 'x'.repeat(MAX_CRASH_STACK + 1) })) ?? '', /stack/)
  assert.match(crashReportProblem({ ...crash(), process: 'browser' }) ?? '', /process/)
  assert.match(crashReportProblem({ ...crash(), kind: 'oops' }) ?? '', /kind/)
  assert.match(crashReportProblem(crash({ exitCode: 1.5 })) ?? '', /exitCode/)
})

test('sanitizeEvent keeps only allow-listed props of the right type', () => {
  const kept = sanitizeEvent('project_open', { tracks: 3, items: 12 }, 1)
  assert.deepEqual(kept, { name: 'project_open', at: 1, props: { tracks: 3, items: 12 } })
  // A name, a path and a prompt offered as props go nowhere.
  const dropped = sanitizeEvent('project_open', { tracks: 3, name: 'Acme launch', path: '/Users/alice/a.bay', prompt: 'make it pop' }, 1)
  assert.deepEqual(dropped, { name: 'project_open', at: 1, props: { tracks: 3 } })
  // Wrong types and values outside an enum are dropped, not coerced.
  assert.deepEqual(sanitizeEvent('project_open', { tracks: '3', items: -1 }, 1), { name: 'project_open', at: 1 })
  assert.deepEqual(sanitizeEvent('page_view', { page: 'secret' }, 1), { name: 'page_view', at: 1 })
  assert.deepEqual(sanitizeEvent('page_view', { page: 'color' }, 1), { name: 'page_view', at: 1, props: { page: 'color' } })
  // A tool name is an identifier, never free text.
  assert.deepEqual(sanitizeEvent('tool_call', { tool: 'Delete everything in ~/x', ok: true }, 1), { name: 'tool_call', at: 1, props: { ok: true } })
  assert.equal(sanitizeEvent('not_an_event', {}, 1), null)
  assert.equal(sanitizeEvent('__proto__', {}, 1), null)
})

test('every event the list allows would pass the contract', () => {
  for (const name of Object.keys(TELEMETRY_EVENTS)) {
    assert.equal(telemetryBatchProblem(batch([event({ name })])), null, name)
    assert.ok(Object.keys(TELEMETRY_EVENTS[name as keyof typeof TELEMETRY_EVENTS]).length <= MAX_PROPS, name)
  }
  assert.deepEqual([...RENDERER_EVENTS], ['page_view'], 'the renderer may ask for page views only')
})
