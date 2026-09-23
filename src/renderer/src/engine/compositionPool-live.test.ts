/**
 * The preview's composition pool while playing. Run with `pnpm test`.
 *
 * The bug this guards: a composition was invisible during playback and appeared on pause,
 * because every playing frame is a new moment not yet decoded and the pool answered only exact
 * hits. The control for every case is the render pool (export, preview_frame), which must keep
 * answering exact-or-nothing — a held frame there would put the wrong picture in a file.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompositionPool } from './compositionPool'
import type { Asset, Item } from '@shared/project'

const FPS = 30
const asset: Asset = {
  id: 'a1', kind: 'html', name: 'cards.html', path: '/tmp/cards.html', durationUs: 10_000_000,
  width: 320, height: 180, fps: null, hasAudio: false, hasVideo: true, posterPath: null,
  waveformPath: null, createdAt: 0, compositionId: 'cards'
}
const item: Item = {
  id: 'i1', assetId: 'a1', trackId: 't', from: 0, durationInFrames: 300, sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 320, height: 180, opacity: 1, rotation: 0 },
  volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
}
const SIZE = { width: 32, height: 18 }

/** A bridge whose captures resolve only when the test says so, recording what was asked. */
function stubBridge(): { asked: number[]; release: () => Promise<void> } {
  const asked: number[] = []
  const waiting: Array<() => void> = []
  ;(globalThis as { window?: unknown }).window = {
    bay: {
      composition: {
        frameAt: (request: { atUs: number; width: number; height: number }) => {
          asked.push(request.atUs)
          return new Promise((resolve) => {
            waiting.push(() => resolve({ width: request.width, height: request.height, data: new Uint8Array(request.width * request.height * 4).buffer }))
          })
        },
        release: async () => undefined
      }
    }
  }
  ;(globalThis as { ImageData?: unknown }).ImageData = class {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data
      this.width = width
      this.height = height
    }
  }
  let made = 0
  ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => ({ id: ++made, close() {} })
  return {
    asked,
    release: async () => {
      while (waiting.length) waiting.shift()!()
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

async function decodedAt(pool: CompositionPool, bridge: ReturnType<typeof stubBridge>, frame: number) {
  pool.frameFor(asset, item, frame, FPS, SIZE)
  await bridge.release()
  const bitmap = pool.frameFor(asset, item, frame, FPS, SIZE)
  assert.ok(bitmap, `specimen: frame ${frame} decoded`)
  return bitmap
}

test('live, a frame not decoded yet shows the latest one that is; a render gets nothing', async () => {
  const bridge = stubBridge()
  const live = new CompositionPool({ live: true })
  const shown = await decodedAt(live, bridge, 10)
  assert.equal(live.frameFor(asset, item, 12, FPS, SIZE), shown, 'the held frame stands in')

  const render = new CompositionPool()
  await decodedAt(render, bridge, 10)
  assert.equal(render.frameFor(asset, item, 12, FPS, SIZE), null, 'a render never takes a stand-in')
})

test('a held frame is never from too long ago, and never from another size', async () => {
  const bridge = stubBridge()
  const live = new CompositionPool({ live: true })
  await decodedAt(live, bridge, 10)
  assert.equal(live.frameFor(asset, item, 10 + 2 * FPS, FPS, SIZE), null, 'two seconds on: nothing rather than a stale card')
  assert.equal(live.frameFor(asset, item, 11, FPS, { width: 64, height: 36 }), null, 'another size is another picture')
})

test('playing, a miss also fetches the next frames; paused, only the one asked for', async () => {
  const bridge = stubBridge()
  const live = new CompositionPool({ live: true })
  live.frameFor(asset, item, 30, FPS, SIZE)
  assert.equal(bridge.asked.length, 1, 'paused: just the frame on screen')
  await bridge.release()
  live.setPlaying(true)
  live.frameFor(asset, item, 60, FPS, SIZE)
  for (let i = 0; i < 3; i++) await bridge.release() // two at a time; let the queue drain
  const frameOf = (us: number) => Math.round((us / 1_000_000) * FPS)
  assert.deepEqual(bridge.asked.slice(1).map(frameOf).sort((a, b) => a - b), [60, 61, 62, 63])
})

test('live, the newest queued moment is fetched first and the oldest backlog is dropped', async () => {
  const bridge = stubBridge()
  const live = new CompositionPool({ live: true })
  for (let frame = 0; frame < 20; frame++) live.frameFor(asset, item, frame, FPS, SIZE)
  // Two start at once (the cap); the rest queue, capped.
  assert.equal(bridge.asked.length, 2)
  await bridge.release()
  const frameOf = (us: number) => Math.round((us / 1_000_000) * FPS)
  assert.deepEqual(bridge.asked.slice(2, 4).map(frameOf), [19, 18], 'newest first')
  // Control: a render pool keeps and serves everything, in order.
  const render = new CompositionPool()
  const renderBridge = stubBridge()
  for (let frame = 0; frame < 20; frame++) render.frameFor(asset, item, frame, FPS, SIZE)
  for (let i = 0; i < 12; i++) await renderBridge.release()
  assert.equal(renderBridge.asked.length, 20, 'a render fetches every frame it asked for')
  assert.deepEqual(renderBridge.asked.slice(0, 4).map(frameOf), [0, 1, 2, 3])
})
