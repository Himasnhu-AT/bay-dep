/**
 * A job started from the Generate tab lands in the media pool whether or not the tab is still
 * showing. Nothing here mounts a component — which is the tab closed, the case that lost paid
 * results when the job ids and the polling lived in the component.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GenerationJob, GenerationSpending, ProviderKeyStatus } from '@shared/generation'
import { createGenerationJobs, type GenerationReader } from './generationJobs'

function job(id: string, status: GenerationJob['status'], outputPath?: string): GenerationJob {
  return {
    id,
    provider: 'openai',
    model: 'gpt-image-1',
    kind: 'image',
    status,
    request: {} as GenerationJob['request'],
    ...(outputPath ? { outputPath } : {}),
    createdAt: 0,
    updatedAt: 0
  }
}

const KEYS: ProviderKeyStatus[] = [{ provider: 'openai', set: true, persisted: true }]
const SPENDING = { spentUsd: 0, budgetUsd: 5, active: 0 } as unknown as GenerationSpending

/** A main whose job list the test advances, and a timer the test fires by hand. */
function harness(options: { imported?: (job: GenerationJob) => boolean } = {}) {
  let list: GenerationJob[] = []
  let failWith: Error | null = null
  const reader: GenerationReader = {
    keys: async () => {
      if (failWith) throw failWith
      return KEYS
    },
    spending: async () => SPENDING,
    jobs: async () => list
  }
  const timers: Array<() => void> = []
  const imports: string[] = []
  const jobs = createGenerationJobs({
    api: () => reader,
    importJob: async (j) => void imports.push(j.id),
    isImported: options.imported ?? (() => false),
    schedule: (run) => void timers.push(run),
    now: () => 1000,
    pollMs: 3000
  })
  /** Fire the pending poll, if any, and wait for its read to settle. */
  const tick = async (): Promise<boolean> => {
    const run = timers.shift()
    if (!run) return false
    run()
    await new Promise((resolve) => setImmediate(resolve))
    return true
  }
  return {
    jobs,
    imports,
    timers,
    tick,
    setList: (next: GenerationJob[]) => void (list = next),
    fail: (error: Error | null) => void (failWith = error)
  }
}

test('a job this window started is imported when it lands, with no tab mounted, by the polling alone', async () => {
  const h = harness()
  h.jobs.adopt('gen_1')
  h.setList([job('gen_1', 'queued')])
  await h.jobs.refresh()
  assert.equal(h.timers.length, 1, 'an active job keeps a poll scheduled')

  h.setList([job('gen_1', 'running')])
  assert.ok(await h.tick())
  assert.deepEqual(h.imports, [], 'still running: nothing to import yet')

  h.setList([job('gen_1', 'done', '/generated/a.png')])
  assert.ok(await h.tick())
  assert.deepEqual(h.imports, ['gen_1'])
  assert.equal(h.timers.length, 0, 'nothing active: polling stops')

  // Landed once; reading the same list again does not import it twice.
  await h.jobs.refresh()
  assert.deepEqual(h.imports, ['gen_1'])
})

test("the agent's own jobs (not adopted) are not imported by the tab", async () => {
  const h = harness()
  h.setList([job('gen_agent', 'done', '/generated/b.png')])
  await h.jobs.refresh()
  assert.deepEqual(h.imports, [])
})

test('a landed job already in the pool is not imported again', async () => {
  const h = harness({ imported: (j) => j.outputPath === '/generated/c.png' })
  h.jobs.adopt('gen_2')
  h.setList([job('gen_2', 'done', '/generated/c.png')])
  await h.jobs.refresh()
  assert.deepEqual(h.imports, [])
})

test('a failed read is kept as a reason, not thrown, and the polling carries on', async () => {
  const h = harness()
  h.jobs.adopt('gen_3')
  h.setList([job('gen_3', 'running')])
  await h.jobs.refresh()
  assert.equal(h.jobs.store.getState().readError, null)

  h.fail(new Error('main is not answering'))
  // Would reject (an unhandled rejection every poll) if the read were not caught.
  await h.jobs.refresh()
  assert.equal(h.jobs.store.getState().readError, 'main is not answering')
  assert.deepEqual(h.jobs.store.getState().keys, KEYS, 'the last good snapshot stays')
  assert.ok(h.timers.length > 0, 'still polling: the job was running when last seen')

  h.fail(null)
  h.setList([job('gen_3', 'done', '/generated/d.png')])
  while (await h.tick()) {}
  assert.equal(h.jobs.store.getState().readError, null)
  assert.deepEqual(h.imports, ['gen_3'])
})

test('a refresh while a poll is scheduled does not schedule a second one', async () => {
  const h = harness()
  h.setList([job('gen_4', 'running')])
  await h.jobs.refresh()
  await h.jobs.refresh()
  await h.jobs.refresh()
  assert.equal(h.timers.length, 1)
})
