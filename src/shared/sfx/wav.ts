/**
 * A stereo render as a WAV file: RIFF, one `fmt ` chunk, one `data` chunk, signed PCM,
 * little-endian, interleaved — the 44-byte canonical layout every decoder reads.
 *
 * 24-bit by default. At 16 bits a reverb tail 70 dB under the hits is a few steps tall and
 * would want dither, and dither is noise in what should be silence; 24 bits puts the steps
 * below anything a film's sound reaches and leaves the silence between hits as exact zeros.
 */

export type WavBitDepth = 16 | 24

export interface WavInfo {
  channels: number
  sampleRate: number
  bitsPerSample: number
  /** Sample frames in the data chunk. */
  frames: number
  /** Byte offset of the first sample. */
  dataOffset: number
}

const HEADER_BYTES = 44

function ascii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}

/** Samples outside ±1 are clamped, not wrapped: a wrap is a full-scale click. */
export function encodeWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bitDepth: WavBitDepth = 24
): Uint8Array {
  if (left.length !== right.length) {
    throw new Error(`The two channels differ in length (${left.length} and ${right.length} samples), so they are not one stereo sound.`)
  }
  const bytesPerSample = bitDepth / 8
  const blockAlign = bytesPerSample * 2
  const dataBytes = left.length * blockAlign
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(bytes.buffer)
  ascii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(view, 8, 'WAVE')
  ascii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  ascii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  const full = 2 ** (bitDepth - 1) - 1
  const put = (sample: number, at: number): void => {
    const value = Math.round(Math.max(-1, Math.min(1, sample)) * full)
    if (bitDepth === 16) {
      view.setInt16(at, value, true)
    } else {
      bytes[at] = value & 0xff
      bytes[at + 1] = (value >> 8) & 0xff
      bytes[at + 2] = (value >> 16) & 0xff
    }
  }
  for (let i = 0; i < left.length; i += 1) {
    const at = HEADER_BYTES + i * blockAlign
    put(left[i]!, at)
    put(right[i]!, at + bytesPerSample)
  }
  return bytes
}

/** Reads the header `encodeWav` writes — or any canonical PCM WAV's. Null when it is not one. */
export function parseWavHeader(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < HEADER_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let offset = 12
  let format: { channels: number; sampleRate: number; bitsPerSample: number; blockAlign: number } | null = null
  while (offset + 8 <= bytes.length) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      if (view.getUint16(offset + 8, true) !== 1) return null
      format = {
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        blockAlign: view.getUint16(offset + 20, true),
        bitsPerSample: view.getUint16(offset + 22, true)
      }
    } else if (id === 'data') {
      if (!format || format.blockAlign === 0) return null
      if (offset + 8 + size > bytes.length) return null
      return {
        channels: format.channels,
        sampleRate: format.sampleRate,
        bitsPerSample: format.bitsPerSample,
        frames: size / format.blockAlign,
        dataOffset: offset + 8
      }
    }
    offset += 8 + size + (size % 2)
  }
  return null
}
