/**
 * `run`'s bounds: a run past its time, or one its caller aborts, is killed — not merely
 * abandoned — and says which it was; without bounds it behaves as it always did.
 *
 * `/bin/sh` stands in for ffmpeg: the property is about the process, not about what it decodes.
 * "Killed" is measured by what the process would have done next: it touches a file after a
 * second, and the file must never appear.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MediaToolError, MediaToolStoppedError, run } from './ffmpeg'

const later = (marker: string): string[] => ['-c', `sleep 1; touch '${marker}'; echo done`]
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test('a run past its timeout is killed and says it timed out', { timeout: 10_000 }, async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'bay-run-')), 'finished')
  const began = Date.now()
  await assert.rejects(run('/bin/sh', later(marker), undefined, { timeoutMs: 150 }), (error: unknown) => {
    assert.ok(error instanceof MediaToolStoppedError)
    assert.equal(error.reason, 'timeout')
    assert.match(error.message, /^sh ran past 1 seconds and was stopped\.$/)
    return true
  })
  assert.ok(Date.now() - began < 900, 'it must not wait for the process to finish on its own')
  await wait(1300)
  assert.equal(existsSync(marker), false, 'the process must be dead, not left running')
})

test('an aborted run is killed and says it was stopped; one aborted before it starts never spawns', { timeout: 10_000 }, async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'bay-run-')), 'finished')
  const controller = new AbortController()
  const running = run('/bin/sh', later(marker), undefined, { signal: controller.signal })
  setTimeout(() => controller.abort(), 100)
  await assert.rejects(running, (error: unknown) => error instanceof MediaToolStoppedError && error.reason === 'aborted')
  await wait(1300)
  assert.equal(existsSync(marker), false)

  const never = join(mkdtempSync(join(tmpdir(), 'bay-run-')), 'finished')
  await assert.rejects(run('/bin/sh', ['-c', `touch '${never}'`], undefined, { signal: AbortSignal.abort() }), MediaToolStoppedError)
  await wait(200)
  assert.equal(existsSync(never), false)
})

test('within its bounds, or with none, a run finishes as before; a failing tool is still a MediaToolError', { timeout: 10_000 }, async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'bay-run-')), 'finished')
  // The same command as above, with room to finish: the positive control for the kill.
  const bounded = await run('/bin/sh', later(marker), undefined, { timeoutMs: 5000, signal: new AbortController().signal })
  assert.equal(bounded.stdout.trim(), 'done')
  assert.equal(existsSync(marker), true)
  const unbounded = await run('/bin/sh', ['-c', 'echo plain'])
  assert.equal(unbounded.stdout.trim(), 'plain')
  await assert.rejects(run('/bin/sh', ['-c', 'echo nope >&2; exit 3'], undefined, { timeoutMs: 5000 }), (error: unknown) => {
    assert.ok(error instanceof MediaToolError)
    assert.equal(error.code, 3)
    return true
  })
})
