/**
 * The compositor draws the keyed layout — the wiring between `@shared/keyframes` and the canvas.
 *
 * The sampler is tested on its own in `shared/keyframes.test.ts`; what a unit test there cannot
 * see is whether the compositor calls it. This drives `drawFrame` against a recording context
 * with a clip whose asset is missing, which draws the placeholder: no decoder, no DOM, and the
 * same `#paintItem` entry every kind of item goes through. The pixels of a real push-in, in
 * `preview_frame` and in an exported file, are measured by `test/app/keyframes.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Item, Project, Timeline } from '@shared/project'
import { Compositor, type RenderTarget } from './compositor'
import { MediaPool } from './mediaPool'

interface Call {
  name: string
  args: unknown[]
  alpha: number
}

function recorder(): { ctx: RenderTarget; calls: Call[] } {
  const calls: Call[] = []
  const state: Record<string | symbol, unknown> = { globalAlpha: 1 }
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        calls.push({ name: String(key), args, alpha: Number(target.globalAlpha) })
        if (key === 'measureText') return { width: 10 }
        return undefined
      }
    },
    set(target, key, value) {
      target[key] = value
      return true
    }
  }) as unknown as RenderTarget
  return { ctx, calls }
}

function scene(item: Item): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000000',
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [item] }]
  }
  const project: Project = {
    id: 'p', name: 'p', version: 1, assets: [], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0
  }
  return { project, timeline }
}

const keyedItem: Item = {
  id: 'itm', assetId: 'gone', trackId: 'v1', from: 30, durationInFrames: 100, sourceStartUs: 0,
  layout: { left: 100, top: 50, width: 800, height: 450, opacity: 1, rotation: 0 },
  volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1,
  keyframes: {
    scale: [{ frame: 0, value: 1 }, { frame: 100, value: 1.5 }],
    opacity: [{ frame: 0, value: 0.2 }, { frame: 100, value: 1 }],
    left: [{ frame: 0, value: 100 }, { frame: 100, value: 300 }]
  }
}

function draw(item: Item, frame: number): Call[] {
  const { ctx, calls } = recorder()
  const { project, timeline } = scene(item)
  new Compositor(new MediaPool()).drawFrame(ctx, project, timeline, frame)
  return calls
}

test('the compositor draws each keyed property at the frame asked for', () => {
  // Item-relative 50 of 100: scale 1.25, opacity 0.6, left 200.
  const calls = draw(keyedItem, 80)
  const zoom = calls.find((c) => c.name === 'scale')
  assert.deepEqual(zoom?.args, [1.25, 1.25], 'the zoom is applied about the box')
  const box = calls.find((c) => c.name === 'fillRect' && c.args[2] === 800)
  assert.ok(box, `the placeholder box is drawn: ${JSON.stringify(calls.map((c) => c.name))}`)
  assert.equal(box.args[0], 200, 'at the keyed left')
  assert.ok(Math.abs(box.alpha - 0.6) < 1e-9, `at the keyed opacity (${box.alpha})`)
  // The centre the zoom is about is the keyed box's centre.
  const translate = calls.find((c) => c.name === 'translate')
  assert.deepEqual(translate?.args, [200 + 400, 50 + 225])
})

test('without keys the same clip draws its static layout and applies no zoom', () => {
  const { keyframes: _dropped, ...plain } = keyedItem
  const calls = draw(plain, 80)
  assert.equal(calls.find((c) => c.name === 'scale'), undefined)
  const box = calls.find((c) => c.name === 'fillRect' && c.args[2] === 800)
  assert.equal(box?.args[0], 100)
  assert.equal(box?.alpha, 1)
})

test('a disabled clip draws nothing; enabled, the same clip draws its box', () => {
  // `disabled` (⇧E) is read in `drawFrame` through `playableTimeline`, the entry the preview,
  // `preview_frame` and export all share.
  const { keyframes: _dropped, ...plain } = keyedItem
  const off = draw({ ...plain, disabled: true }, 80)
  assert.equal(off.find((c) => c.name === 'fillRect' && c.args[2] === 800), undefined)
  const on = draw(plain, 80)
  assert.ok(on.find((c) => c.name === 'fillRect' && c.args[2] === 800), 'positive control: the box is drawn')
})
