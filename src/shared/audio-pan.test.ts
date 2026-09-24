/**
 * The pan law (`panGains`), as numbers: what the preview's channel gains and export's `pan`
 * filter are both written from. The two sides are pinned to it in `engine/audio-pan.test.ts`
 * (routing) and `main/export/pan-render.test.ts` (the filter, and the rendered file).
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panGains } from './audio-gain'
import { formatPan } from './inspector'
import { describeChanges } from './diff'
import type { Item, Project } from './project'

const close = (a: number, b: number, message: string): void =>
  assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`)
const db = (gain: number): number => 20 * Math.log10(gain)

test('centre, and no pan at all, are exactly unity — every clip written before pan sounds as it did', () => {
  for (const pan of [0, undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(panGains(pan as number | undefined), { left: 1, right: 1 }, `pan ${String(pan)}`)
  }
})

test('hard left and hard right silence the far side exactly and lift the near one 3 dB', () => {
  assert.deepEqual(panGains(-1), { left: Math.SQRT2, right: 0 })
  assert.deepEqual(panGains(1), { left: 0, right: Math.SQRT2 })
  assert.ok(Math.abs(db(panGains(-1).left) - 3.0103) < 1e-4, 'hard left is +3.01 dB on the left')
  // Past the ends is the end.
  assert.deepEqual(panGains(-4), panGains(-1))
  assert.deepEqual(panGains(7), panGains(1))
})

test('constant power: left² + right² is 2 at every position, and the law is symmetric', () => {
  for (let i = -100; i <= 100; i += 5) {
    const pan = i / 100
    const { left, right } = panGains(pan)
    close(left * left + right * right, 2, `power at ${pan}`)
    const mirror = panGains(-pan)
    close(left, mirror.right, `symmetry at ${pan}`)
  }
})

test('half left is +2.3 dB / −5.3 dB, and the gains move monotonically across the range', () => {
  const half = panGains(-0.5)
  close(half.left, Math.SQRT2 * Math.cos(Math.PI / 8), 'half left, left')
  close(half.right, Math.SQRT2 * Math.sin(Math.PI / 8), 'half left, right')
  assert.equal(db(half.left).toFixed(1), '2.3')
  assert.equal(db(half.right).toFixed(1), '-5.3')
  let previous = panGains(-1)
  for (let i = -95; i <= 100; i += 5) {
    const next = panGains(i / 100)
    assert.ok(next.left <= previous.left && next.right >= previous.right, `monotone at ${i / 100}`)
    previous = next
  }
})

test('the readout says the side and the percent, and never "L 0"', () => {
  assert.equal(formatPan(0), 'C')
  assert.equal(formatPan(undefined), 'C')
  assert.equal(formatPan(-0.004), 'C')
  assert.equal(formatPan(-0.5), 'L 50')
  assert.equal(formatPan(1), 'R 100')
  assert.equal(formatPan(3), 'R 100')
})

test("a pan change is on the turn's Changes card, and an unchanged pan is not", () => {
  const item: Item = {
    id: 'i', assetId: 'a', trackId: 't', from: 0, durationInFrames: 30, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 10, height: 10, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
  const project = (pan?: number): Project => ({
    id: 'p', name: 'p', version: 1, createdAt: 0, updatedAt: 0, activeTimelineId: 'tl',
    assets: [],
    timelines: [{
      id: 'tl', name: 'T', fps: 30, width: 10, height: 10, background: '#000',
      tracks: [{ id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false,
        items: [pan === undefined ? item : { ...item, pan }] }]
    }]
  })
  const lines = describeChanges(project(), project(-0.5)).map((line) => line.text)
  assert.ok(lines.some((text) => /Pan of .*: C → L 50/.test(text)), lines.join(' | '))
  // Positive control: an explicit 0 and an absent pan are the same position, so no line.
  assert.deepEqual(describeChanges(project(), project(0)), [])
})
