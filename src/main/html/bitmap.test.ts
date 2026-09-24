import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bgraToRgba, describeSizeMismatch, expectedByteLength } from './bitmap'

test('red and blue swap, and alpha and green stay', () => {
  // One pixel, every channel distinct so a wrong move is visible rather than plausible.
  const pixels = new Uint8Array([10, 20, 30, 40])

  bgraToRgba(pixels)

  assert.deepEqual([...pixels], [30, 20, 10, 40])
})

test('swapping twice is the identity, which is what makes the direction checkable', () => {
  const original = [1, 2, 3, 4, 250, 251, 252, 253, 0, 0, 0, 255]
  const pixels = new Uint8Array(original)

  bgraToRgba(bgraToRgba(pixels))

  assert.deepEqual([...pixels], original)
})

test('every pixel is converted, not just the first', () => {
  // The bug this guards is a loop that steps by 1 instead of 4, or forgets to loop at all:
  // the first pixel is right and the rest are not, which looks correct on any single-colour
  // test image.
  const count = 1000
  const pixels = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) {
    pixels.set([i % 256, 0, (i * 7) % 256, 255], i * 4)
  }

  bgraToRgba(pixels)

  for (let i = 0; i < count; i++) {
    assert.equal(pixels[i * 4], (i * 7) % 256, `pixel ${i} red`)
    assert.equal(pixels[i * 4 + 2], i % 256, `pixel ${i} blue`)
    assert.equal(pixels[i * 4 + 3], 255, `pixel ${i} alpha`)
  }
})

test('it converts in place, because a copy per frame is 33MB of garbage at 4K', () => {
  const pixels = new Uint8Array([1, 2, 3, 4])
  assert.equal(bgraToRgba(pixels), pixels)
})

test('a grey pixel is unchanged, so a no-op cannot be mistaken for success', () => {
  // The negative control's partner: if the swap silently did nothing, every test above that
  // uses distinct channels fails — but a test written only with greys would pass. Stated so
  // nobody adds one.
  const grey = new Uint8Array([128, 128, 128, 255])
  bgraToRgba(grey)
  assert.deepEqual([...grey], [128, 128, 128, 255])
})

test('the expected length is derived from the size, never assumed', () => {
  assert.equal(expectedByteLength(1920, 1080), 1920 * 1080 * 4)
  assert.equal(expectedByteLength(1, 1), 4)
})

test('a correctly sized capture reports no mismatch', () => {
  assert.equal(describeSizeMismatch(expectedByteLength(640, 360), 640, 360), null)
})

test('a mismatch names the size the buffer actually is, which is the actionable half', () => {
  // A capture taken mid-resize comes back at the previous size. The message has to let the
  // reader recognise that, not just say the number was wrong.
  const stale = expectedByteLength(1920, 1080)

  const message = describeSizeMismatch(stale, 640, 360)

  assert.ok(message)
  assert.match(message!, /640x360/)
  assert.match(message!, new RegExp(String(1920 * 1080)))
  assert.match(message!, /still at its previous/)
})
