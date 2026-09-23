/**
 * The ffmpeg concurrency bound and the in-flight dedupe. Run with `pnpm test`.
 *
 * The cap is private and derived from the core count, so these tests do not restate it: they
 * measure it, and hold it to what the header promises — at least two at once (or a 200-clip
 * timeline gets one filmstrip at a time), never more than four (or the machine is unusable) —
 * and to never being exceeded once measured.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once, withSlot } from './queue'

/** Lets every queued continuation run. setImmediate runs after the whole microtask queue. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Starts `count` slot-holding jobs, each finishing only when told, and tracks how many run. */
function launch(count: number, failing = false) {
  let running = 0
  let peak = 0
  const gates = Array.from({ length: count }, () => deferred())
  const started: number[] = []
  const done = gates.map((gate, index) =>
    withSlot(async () => {
      running += 1
      peak = Math.max(peak, running)
      started.push(index)
      try {
        await gate.promise
        if (failing) throw new Error(`job ${index} failed`)
        return index
      } finally {
        running -= 1
      }
    })
  )
  return {
    gates,
    started,
    done,
    running: () => running,
    peak: () => peak
  }
}

test('withSlot runs several at once but never more than its cap', { timeout: 5000 }, async () => {
  const jobs = launch(12)
  await settle()
  const cap = jobs.running()
  assert.ok(cap >= 2, `only ${cap} ran at once; a timeline's filmstrips would load one by one`)
  assert.ok(cap <= 4, `${cap} ran at once; the header promises at most four`)
  assert.equal(jobs.started.length, cap, 'the rest must wait for a slot, not start')

  // Release one at a time: each release admits exactly one waiter, in order.
  for (let i = 0; i < 12; i += 1) {
    jobs.gates[i]!.resolve()
    await settle()
    assert.ok(jobs.running() <= cap, `after release ${i}, ${jobs.running()} running with cap ${cap}`)
    assert.equal(jobs.started.length, Math.min(12, cap + i + 1), `after release ${i}`)
  }
  assert.deepEqual(await Promise.all(jobs.done), Array.from({ length: 12 }, (_, i) => i))
  assert.equal(jobs.peak(), cap)
  assert.deepEqual(jobs.started, Array.from({ length: 12 }, (_, i) => i), 'first come, first served')
})

test('a slot handed to a waiter is not also free for a newcomer', { timeout: 5000 }, async () => {
  // The first test queues everything up front, so it cannot see a handoff that forgets to count
  // the waiter: nothing arrives afterwards to take the slot that looks free. This does.
  const first = launch(8)
  await settle()
  const cap = first.running()
  first.gates[0]!.resolve() // hands job 0's slot to job `cap`
  await settle()
  assert.equal(first.running(), cap)

  const late = launch(1)
  await settle()
  assert.equal(late.started.length, 0, 'every slot is taken; the newcomer must queue')
  assert.equal(first.running() + late.running(), cap, `more than ${cap} running at once`)

  for (const gate of [...first.gates, ...late.gates]) gate.resolve()
  await Promise.all([...first.done, ...late.done])
})

test('a job that throws gives its slot back', { timeout: 5000 }, async () => {
  const failing = launch(8, true)
  await settle()
  const cap = failing.running()
  for (const gate of failing.gates) gate.resolve()
  const outcomes = await Promise.allSettled(failing.done)
  assert.ok(outcomes.every((o) => o.status === 'rejected'), 'each failure reaches its own caller')
  assert.match(String((outcomes[0] as PromiseRejectedResult).reason), /job 0 failed/)

  // Were a failed job's slot leaked, `cap` more of these would never start.
  const after = launch(cap)
  await settle()
  assert.equal(after.running(), cap, 'every slot is free again after the failures')
  for (const gate of after.gates) gate.resolve()
  await Promise.all(after.done)
})

test('once runs identical concurrent work a single time and hands both callers its result', async () => {
  let runs = 0
  const gate = deferred()
  const work = async (): Promise<string> => {
    runs += 1
    await gate.promise
    return 'poster.jpg'
  }
  const first = once('poster:a', work)
  const second = once('poster:a', work)
  // Positive control: a different key is different work and runs alongside.
  const other = once('poster:b', work)
  assert.equal(runs, 2, 'poster:a once, poster:b once')
  gate.resolve()
  assert.deepEqual(await Promise.all([first, second, other]), ['poster.jpg', 'poster.jpg', 'poster.jpg'])
})

test('once forgets a finished key, so later work runs again', async () => {
  let runs = 0
  await once('peaks:a', async () => (runs += 1))
  await once('peaks:a', async () => (runs += 1))
  assert.equal(runs, 2)
})

test('once forgets a failed key, so a retry runs instead of replaying the failure', async () => {
  let runs = 0
  const failing = once('filmstrip:a', async () => {
    runs += 1
    throw new Error('ffmpeg exited 1')
  })
  const joined = once('filmstrip:a', async () => 'never runs')
  await assert.rejects(failing, /ffmpeg exited 1/)
  await assert.rejects(joined, /ffmpeg exited 1/, 'a concurrent caller shares the failure')
  const retry = await once('filmstrip:a', async () => {
    runs += 1
    return 'filmstrip.jpg'
  })
  assert.equal(retry, 'filmstrip.jpg')
  assert.equal(runs, 2)
})
