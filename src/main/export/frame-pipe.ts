/**
 * The two properties of the export frame pipe that fail silently.
 *
 * Split out of `encode.ts` for the same reason `serve.ts` was split out of `protocol.ts`:
 * neither of these needs Electron, ffmpeg, or a job, and both are invisible when broken.
 *
 * **Backpressure.** `writeFrame` must not resolve until the pipe has actually taken the
 * bytes. Make it resolve early and nothing observable changes — every frame still arrives,
 * in order, and the file still encodes correctly. The only symptom is memory: the renderer
 * outruns ffmpeg and Node buffers the difference, at 8 MB a frame for 4K. A short test
 * export looks perfect. That is why it gets a test that stalls a pipe and asserts the
 * promise has not settled, rather than a comment asserting the property holds.
 *
 * **Frame validation.** A rawvideo pipe carries no frame numbers, no dimensions and no
 * length — ffmpeg reads `width * height * 4` bytes and calls that a frame, forever. One
 * short buffer or one frame out of order does not error; it shears the rest of the video
 * diagonally. Checking here turns a corrupt file into a message naming the frame.
 */

import type { Writable } from 'node:stream'

/**
 * Writes one frame, resolving only once the stream has actually taken it.
 *
 * The write *callback* is the completion signal, not `write()`'s return value and not
 * `drain`. Node calls it when the sink has accepted this chunk, which is precisely "ffmpeg
 * has the bytes", and it is also the only path that reports a write error.
 *
 * Resolving on `write() === true` instead — the obvious version, and what this was first —
 * has two faults that a passing export hides. It resolves while the chunk is still only in
 * Node's buffer, so an awaiting caller is paced by the buffer rather than by the encoder.
 * And it resolves *before* an EPIPE from a dead ffmpeg can arrive, so an export that failed
 * at the first frame reports every frame written and then produces no file. The second one
 * was caught by a test in this module's suite, not by reading the code.
 */
export function writeFrame(stream: Writable, buffer: Buffer): Promise<void> {
  if (stream.destroyed || stream.writableEnded) {
    return Promise.reject(new Error('The encoder is no longer running.'))
  }
  return new Promise((resolve, reject) => {
    stream.write(buffer, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export interface FrameShape {
  frame: number
  width: number
  height: number
  byteLength: number
}

export interface ExpectedShape {
  /** The frame index the encoder is next able to accept. */
  nextFrame: number
  width: number
  height: number
}

/**
 * Returns the reason this frame cannot be written, or null if it can.
 *
 * A message rather than a boolean: "expected frame 41 but got 43" tells the renderer what
 * its loop did wrong, where `false` would send someone looking at the encoder.
 */
export function frameProblem(frame: FrameShape, expected: ExpectedShape): string | null {
  if (frame.width !== expected.width || frame.height !== expected.height) {
    return `Frame ${frame.frame} is ${frame.width}×${frame.height}; the encoder was opened for ${expected.width}×${expected.height}.`
  }
  // Arrival order *is* the edit — see the header. Out of order is not recoverable downstream.
  if (frame.frame !== expected.nextFrame) {
    return `Expected frame ${expected.nextFrame} but got ${frame.frame}.`
  }
  const wanted = expected.width * expected.height * 4
  if (frame.byteLength !== wanted) {
    return `Frame ${frame.frame} carries ${frame.byteLength} bytes; RGBA at ${expected.width}×${expected.height} is ${wanted}.`
  }
  return null
}
