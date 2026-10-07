/**
 * The queue and the sender, with a fake fetch and a temp folder: what would have been sent, what
 * stays on disk, and what a switch turned off leaves behind (nothing).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CRASH_PATH,
  QUEUE_MAX_CRASHES,
  QUEUE_MAX_EVENTS,
  TELEMETRY_PATH,
  crashReportProblem,
  telemetryBatchProblem,
  type TelemetryEnvelope
} from '@shared/telemetry'
import { MAX_HEAD_STRIKES, TelemetryClient, boundQueue, installIdAt, readQueue, writeQueue, type ClientOptions } from './client'
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, type Fetch } from './policy'

const ORIGIN = 'https://bay.himanshuat.com'
const HOME = '/Users/alice'
const envelope: TelemetryEnvelope = {
  v: 1,
  installId: '3b241101-e2bb-4255-8caf-4136c566a962',
  appVersion: '0.9.0',
  os: 'darwin',
  osVersion: '15.6.0',
  arch: 'arm64'
}

interface Sent {
  url: string
  body: Record<string, unknown>
}

function harness(overrides: Partial<ClientOptions> & { answer?: (url: string) => number | Error } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bay-telemetry-test-'))
  const sent: Sent[] = []
  let clock = 1_700_000_000_000
  const fetcher: Fetch = async (url, init) => {
    const answer = overrides.answer?.(url) ?? 204
    if (answer instanceof Error) throw answer
    sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return new Response(answer === 204 ? null : '{}', { status: answer })
  }
  const queuePath = join(dir, 'telemetry-queue.json')
  const make = (extra: Partial<ClientOptions> = {}) =>
    new TelemetryClient({
      envelope,
      origin: ORIGIN,
      fetch: fetcher,
      queuePath,
      home: HOME,
      switches: { telemetry: true, crash: true },
      now: () => clock,
      random: () => 0,
      ...overrides,
      ...extra
    })
  return {
    dir,
    sent,
    queuePath,
    make,
    advance: (ms: number) => {
      clock += ms
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

test('events go in one batch that meets the contract, and the queue file goes once they are sent', async () => {
  const h = harness()
  try {
    const client = h.make()
    client.track('app_open', { launchMs: 812 })
    client.track('project_open', { tracks: 4, items: 31 })
    client.persist()
    assert.ok(existsSync(h.queuePath), 'queued events were written before the send')
    await client.flush()
    assert.equal(h.sent.length, 1)
    assert.equal(h.sent[0]!.url, `${ORIGIN}${TELEMETRY_PATH}`)
    assert.equal(telemetryBatchProblem(h.sent[0]!.body), null)
    assert.deepEqual((h.sent[0]!.body['events'] as { name: string }[]).map((e) => e.name), ['app_open', 'project_open'])
    assert.equal(existsSync(h.queuePath), false)
  } finally {
    h.cleanup()
  }
})

test('more than 100 events are sent in batches of at most 100', async () => {
  const h = harness()
  try {
    const client = h.make()
    for (let i = 0; i < 250; i++) client.track('tool_call', { tool: 'read_project', ok: true })
    await client.flush()
    assert.deepEqual(h.sent.map((s) => (s.body['events'] as unknown[]).length), [100, 100, 50])
    for (const s of h.sent) assert.equal(telemetryBatchProblem(s.body), null)
  } finally {
    h.cleanup()
  }
})

test('with usage telemetry off, nothing is sent and the queued events are deleted', async () => {
  const h = harness()
  try {
    const client = h.make()
    client.track('app_open', { launchMs: 1 })
    client.persist()
    assert.ok(existsSync(h.queuePath), 'the specimen: a queue on disk before the switch')
    client.setSwitch('telemetry', false)
    assert.equal(existsSync(h.queuePath), false, 'turning it off deleted the file')
    client.track('app_quit')
    await client.flush()
    assert.equal(h.sent.length, 0)
    // Positive control: the same client sends once it is back on — the first event says so.
    client.setSwitch('telemetry', true)
    client.track('app_quit')
    await client.flush()
    assert.deepEqual((h.sent[0]!.body['events'] as { name: string; props?: unknown }[]).map((e) => [e.name, e.props]), [
      ['pref_changed', { key: 'telemetry' }],
      ['app_quit', undefined]
    ])
  } finally {
    h.cleanup()
  }
})

test('with crash reports off, no crash is queued or sent, and queued crashes are deleted', async () => {
  const h = harness({ answer: () => 503 })
  try {
    const client = h.make()
    assert.equal(client.crash({ process: 'main', kind: 'exception', message: 'boom' }), true)
    assert.ok(existsSync(h.queuePath))
    client.setSwitch('crash', false)
    assert.equal(existsSync(h.queuePath), false)
    assert.equal(client.crash({ process: 'main', kind: 'exception', message: 'boom again' }), false)
    assert.deepEqual(client.queued, { events: 0, crashes: 0 })
  } finally {
    h.cleanup()
  }
})

test('both switches off at start: a queue a previous run left is deleted and nothing is sent', async () => {
  const h = harness()
  try {
    writeQueue(h.queuePath, { events: [{ name: 'app_open', at: 1 }], crashes: [] })
    const client = h.make({ switches: { telemetry: false, crash: false } })
    assert.equal(existsSync(h.queuePath), false)
    await client.flush()
    assert.equal(h.sent.length, 0)
  } finally {
    h.cleanup()
  }
})

test('a build with no destination queues nothing, sends nothing and leaves an existing file alone', async () => {
  const h = harness()
  try {
    writeQueue(h.queuePath, { events: [{ name: 'app_open', at: 1 }], crashes: [] })
    const client = h.make({ origin: null })
    client.track('app_open')
    assert.equal(client.crash({ process: 'main', kind: 'exception', message: 'x' }), false)
    await client.flush()
    assert.equal(h.sent.length, 0)
    assert.deepEqual(client.queued, { events: 0, crashes: 0 })
    assert.ok(existsSync(h.queuePath), "an installed bay's queue is not a development build's to delete")
  } finally {
    h.cleanup()
  }
})

test('a crash is redacted before it is queued, and is written to disk at once', async () => {
  const h = harness({ answer: () => new Error('offline') })
  try {
    const client = h.make()
    const message = "ENOENT: open '/Users/alice/Clients/Acme/cut.bay' for alice@example.com"
    const stack = 'Error\n    at save (/Users/alice/code/bay/out/main/index.js:10:2)'
    assert.ok(message.includes('Acme') && message.includes('@example.com') && stack.includes('/Users/alice'))
    client.crash({ process: 'main', kind: 'exception', message, stack })
    const onDisk = readFileSync(h.queuePath, 'utf8')
    for (const secret of ['alice', 'Acme', 'cut.bay', 'example.com', '/code/bay']) assert.ok(!onDisk.includes(secret), `${secret} reached the queue: ${onDisk}`)
    const report = readQueue(h.queuePath).crashes[0]!
    assert.equal(crashReportProblem(report), null)
    assert.equal(report.message, "ENOENT: open '~/…/<file>.bay' for <email>")
    assert.ok(report.stack?.includes('index.js:10:2'))
  } finally {
    h.cleanup()
  }
})

test('an identical crash within ten minutes is reported once', async () => {
  const h = harness()
  try {
    const client = h.make()
    const input = { process: 'renderer' as const, kind: 'renderer-error' as const, message: 'TypeError: x', stack: 'TypeError: x\n    at f (a.js:1:1)' }
    assert.equal(client.crash(input), true)
    assert.equal(client.crash(input), false)
    h.advance(10 * 60_000)
    assert.equal(client.crash(input), true)
    await client.flush()
    assert.equal(h.sent.filter((s) => s.url === `${ORIGIN}${CRASH_PATH}`).length, 2)
  } finally {
    h.cleanup()
  }
})

test('a 400 is dropped and never retried', async () => {
  const h = harness({ answer: () => 400 })
  try {
    const client = h.make()
    client.track('app_open')
    await client.flush()
    assert.equal(h.sent.length, 1)
    assert.deepEqual(client.queued, { events: 0, crashes: 0 })
    await client.flush()
    assert.equal(h.sent.length, 1, 'the refused batch was not sent again')
    assert.match(client.lastProblem ?? '', /malformed/)
  } finally {
    h.cleanup()
  }
})

test('a 5xx or no answer keeps the reports on disk and waits out the backoff before retrying', async () => {
  let answer: number | Error = 503
  const h = harness({ answer: () => answer })
  try {
    const client = h.make()
    client.track('app_open')
    await client.flush()
    assert.equal(h.sent.length, 1)
    assert.deepEqual(client.queued, { events: 1, crashes: 0 })
    assert.ok(existsSync(h.queuePath), 'kept on disk for the next launch')
    assert.match(client.lastProblem ?? '', /503/)

    answer = 204
    h.advance(BACKOFF_BASE_MS - 1)
    await client.flush()
    assert.equal(h.sent.length, 1, 'not before the backoff')
    h.advance(1)
    await client.flush()
    assert.equal(h.sent.length, 2)
    assert.deepEqual(client.queued, { events: 0, crashes: 0 })
    assert.equal(client.lastProblem, null)
    assert.equal(existsSync(h.queuePath), false)

    answer = new Error('ECONNREFUSED')
    client.track('app_quit')
    await client.flush()
    assert.deepEqual(client.queued, { events: 1, crashes: 0 })
    assert.match(client.lastProblem ?? '', /could not be reached/)
  } finally {
    h.cleanup()
  }
})

test('the queue is bounded, oldest dropped first — in memory and on disk', () => {
  const h = harness()
  try {
    const events = Array.from({ length: QUEUE_MAX_EVENTS + 20 }, (_, i) => ({ name: 'app_open', at: i + 1 }))
    const crashes = Array.from({ length: QUEUE_MAX_CRASHES + 5 }, (_, i) => ({ ...envelope, at: i + 1, process: 'main' as const, kind: 'exception' as const, message: `m${i}` }))
    const bounded = boundQueue({ events, crashes })
    assert.equal(bounded.events.length, QUEUE_MAX_EVENTS)
    assert.equal(bounded.events[0]!.at, 21, 'the oldest twenty went')
    assert.equal(bounded.crashes.length, QUEUE_MAX_CRASHES)
    assert.equal(bounded.crashes[0]!.message, 'm5')

    writeFileSync(h.queuePath, JSON.stringify({ events, crashes }))
    const read = readQueue(h.queuePath)
    assert.equal(read.events.length, QUEUE_MAX_EVENTS)
    assert.equal(read.crashes.length, QUEUE_MAX_CRASHES)

    const client = h.make({ answer: () => 503 } as Partial<ClientOptions>)
    for (let i = 0; i < QUEUE_MAX_EVENTS + 50; i++) client.track('app_open')
    assert.equal(client.queued.events, QUEUE_MAX_EVENTS)
  } finally {
    h.cleanup()
  }
})

test('a queue file cannot smuggle out what this build would not queue', () => {
  const h = harness()
  try {
    writeFileSync(
      h.queuePath,
      JSON.stringify({
        events: [
          { name: 'project_open', at: 5, props: { tracks: 2, name: 'Acme launch' } },
          { name: 'exfiltrate', at: 6, props: { path: '/Users/alice' } }
        ],
        crashes: [{ at: 7, message: 'no envelope' }]
      })
    )
    const read = readQueue(h.queuePath)
    assert.deepEqual(read.events, [{ name: 'project_open', at: 5, props: { tracks: 2 } }])
    assert.deepEqual(read.crashes, [])
  } finally {
    h.cleanup()
  }
})

test('the install id is a random v4 UUID kept in its file, and a bad file is replaced', () => {
  const h = harness()
  try {
    const path = join(h.dir, 'install-id')
    const first = installIdAt(path, () => '3b241101-e2bb-4255-8caf-4136c566a962')
    assert.equal(first, '3b241101-e2bb-4255-8caf-4136c566a962')
    assert.equal(installIdAt(path, () => 'never-called'), first, 'kept across launches')
    writeFileSync(path, 'alice@example.com\n')
    assert.equal(installIdAt(path, () => '9f1c2b1e-8a4d-4c7e-9b2a-1d3e5f7a9c0b'), '9f1c2b1e-8a4d-4c7e-9b2a-1d3e5f7a9c0b')
  } finally {
    h.cleanup()
  }
})

test('a crash the site keeps answering 503 does not hold up usage events', async () => {
  const h = harness({ answer: (url) => (url.endsWith(CRASH_PATH) ? 503 : 204) })
  try {
    const client = h.make()
    client.crash({ process: 'main', kind: 'exception', message: 'TypeError: stuck' })
    client.track('app_open')
    await client.flush()
    assert.equal(h.sent.filter((s) => s.url === `${ORIGIN}${TELEMETRY_PATH}`).length, 1, 'the events went although the crash did not')
    assert.deepEqual(client.queued, { events: 0, crashes: 1 })
    // And the events lane is not held to the crash lane's backoff (positive control on the timing).
    client.track('app_quit')
    await client.flush()
    assert.equal(h.sent.filter((s) => s.url === `${ORIGIN}${TELEMETRY_PATH}`).length, 2)
    assert.equal(h.sent.filter((s) => s.url === `${ORIGIN}${CRASH_PATH}`).length, 1, 'the crash waited out its own backoff')
  } finally {
    h.cleanup()
  }
})

test('a report answered "try later" 5 times running is dropped, and the next one is sent', async () => {
  let refuse = true
  const h = harness({ answer: (url) => (url.endsWith(CRASH_PATH) && refuse ? 503 : 204) })
  try {
    const client = h.make()
    client.crash({ process: 'main', kind: 'exception', message: 'TypeError: poison' })
    client.crash({ process: 'main', kind: 'exception', message: 'TypeError: fine' })
    for (let attempt = 1; attempt <= MAX_HEAD_STRIKES; attempt += 1) {
      assert.equal(client.queued.crashes, 2, `still queued before attempt ${attempt}`)
      await client.flush()
      h.advance(BACKOFF_MAX_MS * 2)
    }
    assert.equal(client.queued.crashes, 1, 'the poisoned report was dropped after five')
    assert.match(client.lastProblem ?? '', /after 5 tries it was dropped/)
    refuse = false
    await client.flush()
    assert.equal(client.queued.crashes, 0)
    const bodies = h.sent.filter((s) => s.url === `${ORIGIN}${CRASH_PATH}`).map((s) => s.body['message'])
    assert.deepEqual(bodies, [...Array(MAX_HEAD_STRIKES).fill('TypeError: poison'), 'TypeError: fine'])
  } finally {
    h.cleanup()
  }
})

test('an unreachable site is never a strike: an offline Mac keeps its reports', async () => {
  const h = harness({ answer: () => new Error('ENOTCONNECTED') })
  try {
    const client = h.make()
    client.crash({ process: 'main', kind: 'exception', message: 'TypeError: offline' })
    client.track('app_open')
    for (let attempt = 0; attempt < MAX_HEAD_STRIKES * 3; attempt += 1) {
      await client.flush()
      h.advance(BACKOFF_MAX_MS * 2)
    }
    assert.deepEqual(client.queued, { events: 1, crashes: 1 })
  } finally {
    h.cleanup()
  }
})

test('at most 10 crash reports are queued in any minute, all sources together', () => {
  const h = harness({ answer: () => new Error('offline') })
  try {
    const client = h.make()
    // Distinct signatures, so the per-signature limit cannot be what stops them.
    const admitted = Array.from({ length: 25 }, (_, n) => client.crash({ process: n % 2 ? 'renderer' : 'main', kind: 'exception', message: `TypeError: distinct ${n}` }))
    assert.equal(admitted.filter(Boolean).length, 10)
    assert.equal(client.queued.crashes, 10)
    h.advance(60_000)
    assert.equal(client.crash({ process: 'main', kind: 'exception', message: 'TypeError: after a minute' }), true, 'admits again once the minute has passed')
  } finally {
    h.cleanup()
  }
})
