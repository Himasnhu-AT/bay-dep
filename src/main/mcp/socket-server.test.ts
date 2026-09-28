/**
 * Tests that the agent socket fails *survivably*.
 *
 * The existing tests proved `socketPathIn` throws for an over-long path, which is the easy
 * half and the half that was already true. What nothing held was that the caller survives it
 * — and it did not: `void startMcpServer().then(...)` had no `.catch()`, so the throw became
 * an unhandled rejection naming an internal frame, the intended message never printed, and
 * under `--unhandled-rejections=strict` it would end the launch. The comment two lines above
 * promised graceful degradation that did not happen.
 *
 * So these assert the promise rather than the mechanism: whatever goes wrong, `startSocketServer`
 * resolves, carries a reason, and leaves something that can be closed. That is the shape the
 * database landed on for the same reason — a failure that returns nothing is a failure nobody
 * can report.
 *
 * Mutation-tested: the path-resolution try/catch removed, the listen error handler dropped,
 * `describeSocket` returning null for a failure, and the stale-socket unlink removed. All fail.
 *
 * The last of those initially survived, and for an instructive reason: the restart test closes
 * its server first, and closing unlinks the file — so it never exercised the unlink it looked
 * like it covered. The crash case needs a file nobody closed.
 *
 * Every test carries an explicit timeout, because one of those mutants does not produce a
 * wrong answer — it produces *no* answer. Dropping the listen error handler leaves the promise
 * unsettled forever, and without a bound that stalls the whole suite instead of naming the
 * test. A hang is a worse signal than a failure and should be converted into one.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/mcp/socket-server.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createConnection, type Socket } from 'node:net'
import { join } from 'node:path'
import { describeSocket, startSocketServer } from './socket-server'
import { socketPathIn, MAX_SOCKET_PATH, SOCKET_NAME } from './socket-path'
import type { RunTool } from './protocol'

const refuse: RunTool = async () => ({ ok: false, value: 'nothing here' })

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'bay-sock-'))
}

/** A userData directory long enough to push the socket path over the limit. */
function overlongDir(): string {
  const dir = `/tmp/${'a'.repeat(MAX_SOCKET_PATH)}`
  assert.ok(
    join(dir, SOCKET_NAME).length > MAX_SOCKET_PATH,
    'the fixture must actually exceed the limit, or this test proves nothing'
  )
  return dir
}

// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------

test('an over-long socket path degrades instead of throwing', { timeout: 5000 }, async () => {
  // The exact failure that escaped: `socketPathIn` throws, and before this it threw straight
  // through a call site with no catch.
  const dir = overlongDir()
  assert.throws(() => socketPathIn(dir), /104-byte limit/, 'the check itself must still fire')

  const running = await startSocketServer(() => socketPathIn(dir), refuse)

  assert.equal(running.status.ready, false)
  assert.equal(running.status.path, null)
  assert.notEqual(running.status.error, null, 'a failure with no reason cannot be reported')
  assert.match(running.status.error ?? '', /104-byte limit/)
  await running.close()
})

test('a failure still returns something closeable', { timeout: 5000 }, async () => {
  // Shutdown runs over whatever start returned. A degraded start that returned null would
  // make `stopMcpServer` a second failure on the way out.
  const running = await startSocketServer(() => socketPathIn(overlongDir()), refuse)
  await running.close()
  await running.close()
})

test('any throw from path resolution is caught, not only the length check', { timeout: 5000 }, async () => {
  // The guard is around the resolution, not around one known error, so a future path rule
  // cannot reintroduce the same escape.
  const running = await startSocketServer(() => {
    throw new Error('something else entirely')
  }, refuse)
  assert.equal(running.status.ready, false)
  assert.match(running.status.error ?? '', /something else entirely/)
})

test('a path that cannot be listened on degrades with an actionable reason', { timeout: 5000 }, async () => {
  // A directory that does not exist: `listen` fails *asynchronously*, a different code path
  // from the synchronous throw above and equally unguarded before.
  //
  // The assertion is the errno and the path, not a *particular* errno. macOS answers EACCES
  // here where ENOENT would be the guess — I asserted ENOENT first and it failed, which is
  // the "read the errno, do not assume it" rule arriving from the other direction. Pinning
  // one platform's code would make this a test of macOS rather than of bay.
  const path = join(scratchDir(), 'no-such-directory', SOCKET_NAME)
  const running = await startSocketServer(() => path, refuse)

  assert.equal(running.status.ready, false)
  assert.match(running.status.error ?? '', /\(E[A-Z]+\)/, 'no errno in the reason')
  assert.ok((running.status.error ?? '').includes(path), 'the failing path is not named')
  await running.close()
})

// ---------------------------------------------------------------------------
// The positive control — the negative cases above prove nothing without it
// ---------------------------------------------------------------------------

test('a good path actually listens, and says where', { timeout: 5000 }, async () => {
  // Without this, every assertion above would pass against a function that failed always.
  const dir = scratchDir()
  const running = await startSocketServer(() => socketPathIn(dir), refuse)

  assert.equal(running.status.ready, true, 'the working case must still work')
  assert.equal(running.status.error, null)
  assert.equal(running.status.path, join(dir, SOCKET_NAME))
  await running.close()
})

test('starting twice on the same path succeeds — a stale socket file is not a lock', { timeout: 5000 }, async () => {
  // A crash leaves the socket file behind and `listen` then fails with EADDRINUSE although
  // nothing holds it. Relaunching bay after a crash must not lose the agent surface.
  const dir = scratchDir()
  const first = await startSocketServer(() => socketPathIn(dir), refuse)
  assert.equal(first.status.ready, true)
  await first.close()

  const second = await startSocketServer(() => socketPathIn(dir), refuse)
  assert.equal(second.status.ready, true, 'a leftover socket file blocked the restart')
  await second.close()
})

test('a socket file left behind by a crash does not block the next start', { timeout: 5000 }, async () => {
  // The restart test above closes the server first, which unlinks the file — so it never
  // exercises the unlink at all, and removing that line left it green. This is the real crash
  // shape: a file at the socket path with nothing listening, which makes `listen` fail with
  // EADDRINUSE and would cost the agent surface on every launch until someone deleted it by
  // hand.
  const dir = scratchDir()
  const path = socketPathIn(dir)
  writeFileSync(path, 'left over from a crash')
  assert.equal(existsSync(path), true, 'the fixture must leave a file in the way')

  const running = await startSocketServer(() => path, refuse)
  assert.equal(running.status.ready, true, 'a stale socket file blocked the start')
  await running.close()
})

// ---------------------------------------------------------------------------
// What gets said about it
// ---------------------------------------------------------------------------

test('a failure produces a message that says what still works', { timeout: 5000 }, async () => {
  // The storageReady lesson: a subsystem that has never worked and one nobody has used look
  // identical unless something says which. And it must not read as "bay is broken".
  const running = await startSocketServer(() => socketPathIn(overlongDir()), refuse)
  const message = describeSocket(running.status)

  assert.notEqual(message, null)
  assert.match(message ?? '', /MCP/)
  assert.match(message ?? '', /unaffected/i)
  assert.ok((message ?? '').includes(running.status.error ?? ' '), 'the reason is dropped')
})

test('a working socket says nothing', { timeout: 5000 }, async () => {
  // A line on every launch trains people to skim past the one that matters.
  const dir = scratchDir()
  const running = await startSocketServer(() => socketPathIn(dir), refuse)
  assert.equal(describeSocket(running.status), null)
  await running.close()
})

test('a caller closing its connection aborts the call it left running; one that stays does not', { timeout: 5000 }, async () => {
  // bay's proxy opens one connection per call and drops it when its client goes (a stopped turn).
  // The close is the only word main gets, so it must reach the tool as an abort — that is what
  // stops a waiting `track_export` sleeping on for nobody.
  const signals: AbortSignal[] = []
  const hold: RunTool = (_name, _args, signal) => {
    if (signal) signals.push(signal)
    return new Promise(() => undefined)
  }
  const dir = scratchDir()
  const running = await startSocketServer(() => socketPathIn(dir), hold)
  assert.ok(running.status.ready)
  const open = async (): Promise<Socket> => {
    const client = createConnection(running.status.path!)
    await new Promise<void>((resolve) => client.once('connect', () => resolve()))
    client.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'track_export', arguments: { jobId: 'j' } } }) + '\n')
    return client
  }
  // Bounded, so a failure is a failure rather than a test process that never exits.
  const until = async (ok: () => boolean): Promise<void> => {
    const deadline = Date.now() + 3000
    while (!ok()) {
      if (Date.now() > deadline) assert.fail('the condition did not come true within 3 s')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  const leaving = await open()
  const staying = await open()
  await until(() => signals.length === 2)
  assert.deepEqual(signals.map((s) => s.aborted), [false, false])
  leaving.destroy()
  await until(() => signals[0]!.aborted)
  assert.equal(signals[1]!.aborted, false, 'the other caller is still there')
  staying.destroy()
  await until(() => signals[1]!.aborted)
  await running.close()
})
