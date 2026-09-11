/**
 * A bound on how many ffmpeg processes bay will run at once, and a guard against running the
 * same one twice.
 *
 * A 200-clip timeline asks for 200 filmstrips in the same tick. Spawning 200 decoders makes
 * the machine unusable and finishes no sooner than four would; worse, the React render that
 * asked for them often unmounts before any of them land. Both problems are solved here rather
 * than in each caller, because each caller would solve only its own.
 */

import { cpus } from 'node:os'

const MAX_CONCURRENT = Math.max(2, Math.min(4, Math.floor(cpus().length / 2)))

let active = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  active += 1
}

function release(): void {
  active -= 1
  const next = waiting.shift()
  if (next) next()
}

export async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await work()
  } finally {
    release()
  }
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Runs `work` unless an identical job is already running, in which case both callers await
 * the same promise. Keyed by the same cache key the result is stored under, so two requests
 * that would write the same file never race to write it.
 */
export function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>
  const promise = work().finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}
