/**
 * The WAV writer, checked against the format and not against its own reader. Run with
 * `pnpm test`.
 *
 * A round trip through `encodeWav` and `parseWavHeader` would pass through any shared mistake
 * (both reading a field at the wrong offset), so the header is asserted byte by byte against
 * the canonical 44-byte layout, spelled out here. `main/sfx/write.test.ts` then hands the file
 * to ffprobe, a reader this code cannot have agreed with in advance.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav, parseWavHeader } from './wav'

const text = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to))
const u32 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer).getUint32(at, true)
const u16 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer).getUint16(at, true)

test('the header is the canonical 44 bytes: RIFF, WAVE, fmt (PCM, stereo, rate, depth), data', () => {
  const frames = 100
  const bytes = encodeWav(new Float32Array(frames), new Float32Array(frames), 48_000, 24)
  assert.equal(bytes.length, 44 + frames * 6)
  assert.equal(text(bytes, 0, 4), 'RIFF')
  assert.equal(u32(bytes, 4), bytes.length - 8)
  assert.equal(text(bytes, 8, 12), 'WAVE')
  assert.equal(text(bytes, 12, 16), 'fmt ')
  assert.equal(u32(bytes, 16), 16)
  assert.equal(u16(bytes, 20), 1, 'format tag: PCM')
  assert.equal(u16(bytes, 22), 2, 'channels')
  assert.equal(u32(bytes, 24), 48_000, 'sample rate')
  assert.equal(u32(bytes, 28), 48_000 * 6, 'bytes a second')
  assert.equal(u16(bytes, 32), 6, 'block align')
  assert.equal(u16(bytes, 34), 24, 'bits per sample')
  assert.equal(text(bytes, 36, 40), 'data')
  assert.equal(u32(bytes, 40), frames * 6)
})

test('samples are signed little-endian, interleaved left then right, at 24 and at 16 bits', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1])
  const right = new Float32Array([-1, 0.25, 0, 0])
  const deep = encodeWav(left, right, 48_000, 24)
  const s24 = (frame: number, channel: number): number => {
    const at = 44 + frame * 6 + channel * 3
    const value = deep[at]! | (deep[at + 1]! << 8) | (deep[at + 2]! << 16)
    return value >= 0x800000 ? value - 0x1000000 : value
  }
  assert.equal(s24(0, 0), 0)
  assert.equal(s24(0, 1), -8388607)
  assert.equal(s24(1, 0), 4194304)
  assert.equal(s24(1, 1), 2097152)
  assert.equal(s24(2, 0), -4194303)
  assert.equal(s24(3, 0), 8388607)

  const shallow = encodeWav(left, right, 44_100, 16)
  assert.equal(shallow.length, 44 + 4 * 4)
  const view = new DataView(shallow.buffer)
  assert.equal(view.getInt16(44, true), 0)
  assert.equal(view.getInt16(46, true), -32767)
  assert.equal(view.getInt16(48, true), 16384)
  assert.equal(view.getInt16(56, true), 32767)
  assert.equal(u16(shallow, 34), 16)
  assert.equal(u32(shallow, 24), 44_100)
})

test('a sample past full scale is clamped, not wrapped into a click of the opposite sign', () => {
  const bytes = encodeWav(new Float32Array([1.7, -3]), new Float32Array([0, 0]), 48_000, 16)
  const view = new DataView(bytes.buffer)
  assert.equal(view.getInt16(44, true), 32767)
  assert.equal(view.getInt16(48, true), -32767)
})

test('channels of different lengths are refused, saying both lengths', () => {
  assert.throws(() => encodeWav(new Float32Array(3), new Float32Array(4), 48_000), /differ in length \(3 and 4 samples\)/)
})

test('the header reader reads what was written, finds data after other chunks, and refuses what is not PCM WAV', () => {
  const bytes = encodeWav(new Float32Array(480), new Float32Array(480), 48_000, 24)
  assert.deepEqual(parseWavHeader(bytes), { channels: 2, sampleRate: 48_000, bitsPerSample: 24, frames: 480, dataOffset: 44 })

  // A LIST chunk of odd length between fmt and data, as other writers put there.
  const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0])
  const padded = new Uint8Array(bytes.length + list.length)
  padded.set(bytes.subarray(0, 36))
  padded.set(list, 36)
  padded.set(bytes.subarray(36), 36 + list.length)
  assert.deepEqual(parseWavHeader(padded), { channels: 2, sampleRate: 48_000, bitsPerSample: 24, frames: 480, dataOffset: 44 + list.length })

  assert.equal(parseWavHeader(new Uint8Array(10)), null)
  const notRiff = bytes.slice()
  notRiff[0] = 0x58
  assert.equal(parseWavHeader(notRiff), null)
  const float = bytes.slice()
  float[20] = 3 // IEEE float, which this file is not
  assert.equal(parseWavHeader(float), null)
  assert.equal(parseWavHeader(bytes.subarray(0, bytes.length - 10)), null, 'a data chunk longer than the file')
})
