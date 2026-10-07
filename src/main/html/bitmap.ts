/**
 * Turning what Electron hands back into what a canvas can draw.
 *
 * `nativeImage.toBitmap()` returns the image's raw pixel data in **BGRA** order, which is the
 * order Skia keeps it in. `ImageData` — the only way to get an arbitrary buffer into an
 * `ImageBitmap` without an encode round trip — is **RGBA**. Handing one to the other without a
 * swap does not fail: it renders, and every colour comes out with red and blue exchanged. A
 * blue-tinted composition looks like a styling mistake in the composition, which is where
 * somebody would go looking.
 *
 * Split out here because it is the one part of this subsystem that can be tested at all:
 * `pnpm test` runs under plain Node and cannot load anything that imports `electron`, so the
 * window management next door is reachable only by `pnpm typecheck`. Anything that can be
 * pure logic instead of an Electron call should be, for exactly that reason.
 */

/** Bytes per pixel in both layouts. Named because the arithmetic below is otherwise magic. */
const CHANNELS = 4

/**
 * Swap BGRA to RGBA in place, returning the same buffer.
 *
 * In place because a 4K frame is 33 MB and a copy per frame is 33 MB of garbage per frame.
 * The alpha channel is already where it belongs, so only the two colour channels move.
 */
export function bgraToRgba(pixels: Uint8Array): Uint8Array {
  for (let i = 0; i < pixels.length; i += CHANNELS) {
    const blue = pixels[i]!
    pixels[i] = pixels[i + 2]!
    pixels[i + 2] = blue
  }
  return pixels
}

/**
 * Is this buffer the size a `width x height` RGBA image should be?
 *
 * Worth checking rather than trusting: a capture taken while a window is being resized comes
 * back at the old size, and the mismatch surfaces downstream as a torn or shifted picture
 * rather than as an error. Comparing the length is free and turns that into a refusal.
 */
export function expectedByteLength(width: number, height: number): number {
  return width * height * CHANNELS
}

export function describeSizeMismatch(
  actual: number,
  width: number,
  height: number
): string | null {
  const expected = expectedByteLength(width, height)
  if (actual === expected) return null
  // Naming the size it *does* match is the useful half: it is almost always the previous
  // request's size, which says the window had not finished resizing.
  const pixels = actual / CHANNELS
  return (
    `The capture is ${actual} bytes, but ${width}x${height} needs ${expected}. ` +
    `That buffer holds ${pixels} pixels, so the window was most likely still at its previous ` +
    `size when the frame was taken.`
  )
}

/**
 * How different two captures are: the mean absolute luma difference, 0–255.
 *
 * This is the film oracle's picture energy (`@shared/film-oracle`): 0 is the same picture, a
 * hard cut between unrelated scenes is tens. Both buffers are `toBitmap()` output — BGRA,
 * premultiplied — so a transparent pixel is already black here and a composition with no
 * background of its own is measured as it would sit over black. Null when the two are not the
 * same size, which is a capture taken mid-resize and not a difference.
 */
export function lumaDelta(a: Uint8Array, b: Uint8Array): number | null {
  if (a.length !== b.length || a.length === 0) return null
  let sum = 0
  for (let i = 0; i < a.length; i += CHANNELS) {
    const ya = 0.114 * a[i]! + 0.587 * a[i + 1]! + 0.299 * a[i + 2]!
    const yb = 0.114 * b[i]! + 0.587 * b[i + 1]! + 0.299 * b[i + 2]!
    sum += Math.abs(ya - yb)
  }
  return sum / (a.length / CHANNELS)
}
