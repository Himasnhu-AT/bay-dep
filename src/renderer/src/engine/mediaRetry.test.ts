/**
 * A media element whose first load fails is retried WITH CORS, never without.
 *
 * Retrying without `crossOrigin` made the element play silence through Web Audio (the score read
 * peak 0 without CORS, 0.69 with it) and tainted the export canvas, for the rest of the session,
 * with nothing reporting it. The pool is driven here with fake elements that fail their first
 * load(s), so the behaviour — not the delay table — is what is asserted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { LOAD_RETRY_DELAYS_MS } from './mediaRetry'

class FakeEl {
  crossOrigin: string | null = null
  src = ''
  loads = 0
  crossOriginAtLoad: (string | null)[] = []
  error: { code: number } | null = null
  preload = ''
  volume = 1
  autoplay = true
  playsInline = false
  failures = 0
  private listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn)
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn()
  }
  pause(): void {}
  removeAttribute(): void {}
  play(): Promise<void> { return Promise.resolve() }
  load(): void {
    this.loads += 1
    this.crossOriginAtLoad.push(this.crossOrigin)
    const fail = this.failures > 0
    if (fail) this.failures -= 1
    queueMicrotask(() => {
      if (fail) {
        this.error = { code: 4 }
        this.fire('error')
      } else this.fire('loadeddata')
    })
  }
}
class FakeMedia extends FakeEl {}
class FakeVideo extends FakeMedia {}
class FakeImage extends FakeEl {}
class FakeAudio extends FakeMedia {}

let failuresForNext = 0
const created: FakeEl[] = []
Object.assign(globalThis, {
  HTMLMediaElement: FakeMedia,
  HTMLVideoElement: FakeVideo,
  HTMLImageElement: FakeImage,
  HTMLAudioElement: FakeAudio,
  document: {
    createElement(tag: string) {
      const el = tag === 'video' ? new FakeVideo() : tag === 'img' ? new FakeImage() : new FakeAudio()
      el.failures = failuresForNext
      created.push(el)
      return el
    }
  }
})

const { MediaPool } = await import('./mediaPool')

function video(id: string): Asset {
  return {
    id, kind: 'video', name: `${id}.mp4`, path: `/tmp/${id}.mp4`, durationUs: 5_000_000, width: 1080, height: 1920,
    hasAudio: true, hasVideo: true, createdAt: 0
  } as Asset
}

async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

test('a load that fails once is retried with CORS and becomes ready (silence was the old outcome)', { timeout: 10_000 }, async () => {
  failuresForNext = 1
  const pool = new MediaPool()
  const entry = pool.acquire(video('a'))
  const el = created.at(-1)!
  await settle(LOAD_RETRY_DELAYS_MS[0]! + 100)
  assert.equal(el.loads, 2, 'the failed load was retried once')
  assert.deepEqual(el.crossOriginAtLoad, ['anonymous', 'anonymous'], 'every load, including the retry, asks for CORS')
  assert.equal(pool.readiness('a').status === 'error', false, `the retried element is not an error: ${JSON.stringify(entry.status)}`)
  pool.dispose()
})

test('a load that keeps failing gives up with an error after the last retry, still never dropping CORS', { timeout: 10_000 }, async () => {
  failuresForNext = 99
  const pool = new MediaPool()
  pool.acquire(video('b'))
  const el = created.at(-1)!
  await settle(LOAD_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + 300)
  assert.equal(el.loads, 1 + LOAD_RETRY_DELAYS_MS.length)
  assert.ok(el.crossOriginAtLoad.every((c) => c === 'anonymous'), JSON.stringify(el.crossOriginAtLoad))
  assert.equal(pool.peek('b')?.status, 'error')
  pool.dispose()
})
