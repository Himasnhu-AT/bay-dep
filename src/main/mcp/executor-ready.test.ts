/**
 * The cold-start wait. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExecutorReadiness, strandedCall } from './executor-ready'
import { findTool } from '@shared/mcp'

test('a call waits for a window that is still loading, and goes as soon as it is ready', async () => {
  // The cold-start bug: the first call reached a page with no listener and was lost.
  const readiness = new ExecutorReadiness()
  let settled: boolean | null = null
  const waiting = readiness.whenReady(7, 5_000).then((ready) => (settled = ready))
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(settled, null, 'resolved before the renderer said it was listening')
  readiness.set(7, true)
  assert.equal(await waiting, true)
})

test('a ready window is answered at once', async () => {
  const readiness = new ExecutorReadiness()
  readiness.set(1, true)
  const started = Date.now()
  assert.equal(await readiness.whenReady(1, 5_000), true)
  assert.ok(Date.now() - started < 50)
})

test('a window that never becomes ready times out as not ready, rather than hanging', async () => {
  const readiness = new ExecutorReadiness()
  assert.equal(await readiness.whenReady(3, 30), false)
})

test('a reload makes a window not ready again until it re-registers', async () => {
  // A reload unmounts the executor. A call in that gap must wait, not be pushed into a page
  // that is tearing down.
  const readiness = new ExecutorReadiness()
  readiness.set(2, true)
  readiness.set(2, false)
  assert.equal(readiness.isReady(2), false)
  assert.equal(await readiness.whenReady(2, 30), false)
})

test('readiness is per window: another window becoming ready does not release this one', async () => {
  const readiness = new ExecutorReadiness()
  const waiting = readiness.whenReady(4, 60)
  readiness.set(5, true)
  assert.equal(await waiting, false)
})

test('a destroyed window releases its waiters at once, as not ready', async () => {
  const readiness = new ExecutorReadiness()
  const started = Date.now()
  const waiting = readiness.whenReady(6, 5_000)
  readiness.forget(6)
  assert.equal(await waiting, false)
  assert.ok(Date.now() - started < 1_000, 'waited out the timeout instead of being released')
})

// --- calls stranded by a reload --------------------------------------------------------------

const readOnly = (name: string): boolean => findTool(name)?.readOnly ?? false

test('a read stranded by a reload is sent again, because it changed nothing', () => {
  assert.deepEqual(strandedCall('read_project', readOnly), { action: 'resend' })
  assert.deepEqual(strandedCall('preview_frame', readOnly), { action: 'resend' })
})

test('a write stranded by a reload fails at once and says to check before retrying', () => {
  // Resending would apply it twice if the old page got as far as applying it.
  const verdict = strandedCall('remove_range', readOnly)
  assert.equal(verdict.action, 'fail')
  assert.match(verdict.action === 'fail' ? verdict.error : '', /may or may not have been applied.*read_project/)
})

test('an unknown tool is treated as a write, never resent', () => {
  assert.equal(strandedCall('no_such_tool', readOnly).action, 'fail')
})
