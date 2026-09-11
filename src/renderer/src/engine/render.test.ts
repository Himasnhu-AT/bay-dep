/**
 * Tests for the preview frame's sizing arithmetic.
 *
 * `previewSize` decides what an agent is charged tokens to look at, and it has one rule that
 * is easy to get backwards: it caps, and it never upscales. A 320x240 project asked for 640
 * comes back at 320x240 — there is nothing in the source to fill the extra pixels, and an
 * upscaled frame is interpolation billed as information.
 *
 * What this cannot cover is the rest of `renderFrame`: awaiting a real decode, a real seek,
 * and a real PNG encode all need a DOM, a decoder and a window. That is `test/app/preview-frame.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewSize, DEFAULT_PREVIEW_MAX_EDGE } from './render'

test('a landscape project is capped on its width', () => {
  assert.deepEqual(previewSize(1920, 1080, 640), { width: 640, height: 360 })
})

test('a portrait project is capped on its height', () => {
  // The cap is the longest edge, not the width — a 9:16 clip capped on width would come
  // back 640x1138, which is larger than the landscape case it was meant to match.
  assert.deepEqual(previewSize(1080, 1920, 640), { width: 360, height: 640 })
})

test('a square project is capped on both', () => {
  assert.deepEqual(previewSize(1080, 1080, 640), { width: 640, height: 640 })
})

test('aspect ratio survives the cap', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1280, 720], [720, 1280], [2560, 1080]]) {
    const out = previewSize(w!, h!, 640)
    assert.ok(
      Math.abs(out.width / out.height - w! / h!) < 0.01,
      `${w}x${h} -> ${out.width}x${out.height} changed the aspect ratio`
    )
  }
})

test('a project smaller than the cap is never upscaled', () => {
  // The rule that is easy to reverse: an upscaled preview costs more tokens and carries
  // no more information than the original.
  assert.deepEqual(previewSize(320, 240, 640), { width: 320, height: 240 })
  assert.deepEqual(previewSize(64, 64, 640), { width: 64, height: 64 })
  assert.deepEqual(previewSize(640, 360, 640), { width: 640, height: 360 })
})

test('the default cap is what the tool advertises', () => {
  assert.deepEqual(previewSize(1920, 1080, DEFAULT_PREVIEW_MAX_EDGE), { width: 640, height: 360 })
})

test('degenerate sizes still produce a drawable canvas', () => {
  // `canvas.width = 0` throws nothing but renders nothing; every result here must be >= 1.
  for (const [w, h, cap] of [[0, 0, 640], [1, 1, 640], [1920, 1080, 0], [1920, 1080, 1], [-5, -5, 640]]) {
    const out = previewSize(w!, h!, cap!)
    assert.ok(out.width >= 1 && out.height >= 1, `${w}x${h}@${cap} -> ${JSON.stringify(out)}`)
  }
})

test('an enormous cap does not upscale a normal project', () => {
  assert.deepEqual(previewSize(1920, 1080, 100_000), { width: 1920, height: 1080 })
})
