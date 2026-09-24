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
  srcAtLoad: string[] = []
  load(): void {
    this.loads += 1
    this.crossOriginAtLoad.push(this.crossOrigin)
    this.srcAtLoad.push(this.src)
    // `failures` is the server refusing (a path main has not allowlisted yet). On top of that,
    // Chromium remembers a failed load per URL and CORS mode: measured in the app, the same URL
    // went on failing with error 4 — on the same element and on a new one — after a fetch of it
    // already answered 200. The fake keeps that memory, or it tests a browser that does not exist.
    const key = `${this.src}|${this.crossOrigin}`
    const refused = this.failures > 0
    if (refused) this.failures -= 1
    const fail = refused || failedUrls.has(key)
    if (fail) failedUrls.add(key)
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
const failedUrls = new Set<string>()
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

test('a retry never asks for a URL that already failed: the browser would answer from its memory of the failure', { timeout: 10_000 }, async () => {
  // Refused once (not allowlisted yet), then the server would serve it. The retry must reach the
  // server: a retry of the identical URL is answered with the remembered error, three times over,
  // and the clip ends as "could not be read" — the failure 8afacd6's retry never escaped.
  failuresForNext = 1
  const pool = new MediaPool()
  pool.acquire(video('c'))
  const el = created.at(-1)!
  await settle(LOAD_RETRY_DELAYS_MS[0]! + 100)
  assert.equal(new Set(el.srcAtLoad).size, el.srcAtLoad.length, `every load is a distinct URL: ${JSON.stringify(el.srcAtLoad)}`)
  assert.ok(el.srcAtLoad.every((u) => u.startsWith(el.srcAtLoad[0]!)), 'every retry is the same file')
  assert.equal(pool.peek('c')?.status, 'ready', `the retried element loaded: ${pool.peek('c')?.status}`)
  pool.dispose()
})
