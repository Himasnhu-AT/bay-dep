import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SITE_ORIGIN } from '@shared/access'
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, CrashLimiter, RateWindow, backoffMs, crashSignature, guardedTelemetryFetch, rendererErrorReport, telemetryOrigin, verdictFor, type Fetch } from './policy'
import { MAX_CRASH_MESSAGE, MAX_CRASH_STACK } from '@shared/telemetry'

test('an installed bay reports to the site and nowhere else, whatever its environment says', () => {
  assert.deepEqual(telemetryOrigin({}, true), { kind: 'site', origin: SITE_ORIGIN })
  assert.deepEqual(telemetryOrigin({ BAY_TELEMETRY_BASE: 'http://127.0.0.1:9999' }, true), { kind: 'site', origin: SITE_ORIGIN })
})

test('a development build sends nothing unless BAY_TELEMETRY_BASE names a loopback stub', () => {
  assert.equal(telemetryOrigin({}, false).kind, 'none')
  assert.deepEqual(telemetryOrigin({ BAY_TELEMETRY_BASE: 'http://127.0.0.1:9999/ignored/path' }, false), { kind: 'local', origin: 'http://127.0.0.1:9999' })
  assert.deepEqual(telemetryOrigin({ BAY_TELEMETRY_BASE: 'http://[::1]:3000' }, false), { kind: 'local', origin: 'http://[::1]:3000' })
  // A name is not a literal address: `localhost` would be resolved (and /etc/hosts can point it anywhere).
  const named = telemetryOrigin({ BAY_TELEMETRY_BASE: 'http://localhost:3000' }, false)
  assert.equal(named.kind, 'none')
  assert.match(named.kind === 'none' ? named.reason : '', /127\.0\.0\.1/)
  // Production, a remote host, a private address and a non-URL are all refused — never a fallback to the site.
  for (const value of [SITE_ORIGIN, 'http://example.com', 'http://10.0.0.2:3000', 'not a url', 'ftp://127.0.0.1']) {
    const origin = telemetryOrigin({ BAY_TELEMETRY_BASE: value }, false)
    assert.equal(origin.kind, 'none', value)
  }
})

test('the guarded fetch refuses any other host, and passes the one origin through (positive control)', async () => {
  const seen: string[] = []
  const inner: Fetch = async (url, init) => {
    seen.push(url)
    assert.equal(init?.redirect, 'error', 'a redirect must not carry a report elsewhere')
    return new Response(null, { status: 204 })
  }
  const guarded = guardedTelemetryFetch(inner, 'https://bay.himanshuat.com')
  await assert.rejects(guarded('https://evil.example.com/api/telemetry'), /refused to contact evil\.example\.com/)
  // Same host name, another scheme or port, is another origin.
  await assert.rejects(guarded('http://bay.himanshuat.com/api/telemetry'), /refused/)
  await assert.rejects(guarded('https://bay.himanshuat.com.evil.com/api/telemetry'), /refused/)
  await assert.rejects(guarded('not a url'), /malformed/)
  assert.deepEqual(seen, [], 'nothing refused reached the network')
  const response = await guarded('https://bay.himanshuat.com/api/telemetry', { method: 'POST' })
  assert.equal(response.status, 204)
  assert.deepEqual(seen, ['https://bay.himanshuat.com/api/telemetry'])
})

test('backoff doubles from a minute to an hour, with at most a fifth of jitter', () => {
  assert.equal(backoffMs(0, 0), 0)
  assert.equal(backoffMs(1, 0), BACKOFF_BASE_MS)
  assert.equal(backoffMs(2, 0), BACKOFF_BASE_MS * 2)
  assert.equal(backoffMs(3, 0), BACKOFF_BASE_MS * 4)
  assert.equal(backoffMs(50, 0), BACKOFF_MAX_MS)
  assert.equal(backoffMs(1, 0.999999), Math.round(BACKOFF_BASE_MS * 1.2))
  assert.ok(backoffMs(50, 1) <= BACKOFF_MAX_MS * 1.2)
})

test('400 is dropped and never retried; 429, 5xx and others are retried; 2xx is sent', () => {
  assert.equal(verdictFor(204), 'sent')
  assert.equal(verdictFor(200), 'sent')
  assert.equal(verdictFor(400), 'drop')
  assert.equal(verdictFor(413), 'drop')
  assert.equal(verdictFor(429), 'retry')
  assert.equal(verdictFor(500), 'retry')
  assert.equal(verdictFor(503), 'retry')
  assert.equal(verdictFor(404), 'retry')
})

test('an identical crash is admitted once per window; another signature is not held back', () => {
  const limiter = new CrashLimiter(600_000)
  const a = crashSignature({ process: 'main', kind: 'exception', message: 'TypeError: x\nmore', stack: 'TypeError: x\n    at f (index.js:1:1)\n    at g' })
  const b = crashSignature({ process: 'renderer', kind: 'exception', message: 'TypeError: x', stack: 'TypeError: x\n    at f (index.js:1:1)' })
  assert.notEqual(a, b)
  assert.equal(limiter.admit(a, 1_000), true)
  assert.equal(limiter.admit(a, 1_000 + 599_999), false)
  assert.equal(limiter.admit(b, 2_000), true, 'a different crash is reported')
  assert.equal(limiter.admit(a, 1_000 + 600_000), true, 'and the same one again after ten minutes')
})

test('a renderer error report is cut to the caps at the boundary, and anything else is refused', () => {
  const huge = 'x'.repeat(5_000_000)
  const report = rendererErrorReport({ kind: 'rejection', message: huge, stack: huge })
  assert.equal(report?.message.length, MAX_CRASH_MESSAGE)
  assert.equal(report?.stack?.length, MAX_CRASH_STACK)
  assert.equal(report?.kind, 'rejection')
  assert.equal(rendererErrorReport({ kind: 'anything', message: 'm' })?.kind, 'error')
  for (const bad of [null, 'text', 42, { message: 7 }, { kind: 'error' }]) assert.equal(rendererErrorReport(bad), null, JSON.stringify(bad))
  // Positive control: a normal report passes through unchanged.
  assert.deepEqual(rendererErrorReport({ kind: 'error', message: 'TypeError: x', stack: 'at f (a.js:1:1)' }), { kind: 'error', message: 'TypeError: x', stack: 'at f (a.js:1:1)' })
})

test('the rate window admits its limit per window and no more, then admits again once the window passes', () => {
  const window = new RateWindow(3, 60_000)
  assert.deepEqual([0, 1, 2, 3].map((t) => window.admit(t)), [true, true, true, false])
  assert.equal(window.admit(59_999), false)
  assert.equal(window.admit(60_000), true, 'the first admission has aged out')
})
