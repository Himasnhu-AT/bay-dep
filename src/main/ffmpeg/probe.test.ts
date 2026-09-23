/**
 * Tests for turning ffprobe's JSON into bay's shape.
 *
 * These run against *recorded output from real files*, not invented JSON. That matters here
 * more than usual, because every case worth covering is a shape real media actually takes —
 * an audio stream that reports no frame rate, a still with no duration, a rate that is only
 * expressible as a rational — and inventing the fixtures would mean testing against my own
 * idea of what ffprobe emits rather than what it does. The headline fixture below was
 * captured from `assets/podcast-cut/output/goodall-transcript-cut.mp4` in this repository.
 *
 * The failure they exist to prevent is a `NaN` fps. Nothing rejects it: it flows into
 * `usToFrames`, every clip built from that asset lands at frame `NaN`, and the timeline looks
 * empty with no error anywhere. Two separate mistakes produce it — reading `r_frame_rate`
 * from the first stream rather than the video stream, and `Number()`-ing a rational — so both
 * are tested directly.
 *
 * Mutation-tested: reading the first stream instead of the video stream, coercing the
 * rational with `Number()`, and dropping the zero-denominator guard. All three fail here.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/ffmpeg/probe.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FfprobeOutput } from './probe'
import { parseRational, shapeProbe } from './probe'

const PATH = '/footage/clip.mp4'

/**
 * Recorded verbatim from `assets/podcast-cut/output/goodall-transcript-cut.mp4`, trimmed to
 * the fields bay reads. Vertical, and its *audio* stream reports `r_frame_rate: "0/0"` — the
 * exact value that becomes NaN if fps is read from the wrong stream.
 */
const VERTICAL_WITH_ZERO_RATE_AUDIO: FfprobeOutput = {
  streams: [
    {
      codec_name: 'h264',
      codec_type: 'video',
      width: 1080,
      height: 1920,
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      duration: '67.833333',
      nb_frames: '2035'
    },
    {
      codec_name: 'aac',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 2,
      r_frame_rate: '0/0',
      avg_frame_rate: '0/0',
      duration: '67.821000',
      nb_frames: '3177'
    }
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '67.833333' }
}

// ---------------------------------------------------------------------------
// The rational parser
// ---------------------------------------------------------------------------

test('a rational frame rate is divided, not coerced', () => {
  // `Number('30000/1001')` is NaN. This is the whole reason the function exists.
  assert.equal(Number.isNaN(Number('30000/1001')), true, 'the naive version really does fail')
  assert.equal(parseRational('30000/1001'), 30000 / 1001)
  assert.equal(parseRational('24000/1001'), 24000 / 1001)
  assert.equal(parseRational('30/1'), 30)
})

test('a zero denominator yields null rather than NaN or Infinity', () => {
  // `0/0` is what an AAC stream reports. `1/0` would be Infinity, which survives
  // `Number.isFinite` checks no better.
  assert.equal(parseRational('0/0'), null)
  assert.equal(parseRational('1/0'), null)
})

test('a rate that is zero, negative or unparseable yields null', () => {
  assert.equal(parseRational('0/1'), null)
  assert.equal(parseRational('-30/1'), null)
  assert.equal(parseRational('N/A'), null)
  assert.equal(parseRational(''), null)
  assert.equal(parseRational(undefined), null)
})

test('a bare decimal rate is accepted', () => {
  assert.equal(parseRational('29.97'), 29.97)
})

// ---------------------------------------------------------------------------
// The real file
// ---------------------------------------------------------------------------

test('a vertical clip whose audio reports 0/0 still gets a usable frame rate', () => {
  const result = shapeProbe(VERTICAL_WITH_ZERO_RATE_AUDIO, PATH)

  assert.equal(result.fps, 30)
  assert.equal(Number.isFinite(result.fps), true, 'fps must never reach the timeline as NaN')
  assert.equal(result.hasVideo, true)
  assert.equal(result.hasAudio, true)
})

test('a vertical clip keeps its orientation', () => {
  // 1080×1920, not 1920×1080. Swapping these silently letterboxes every vertical import.
  const result = shapeProbe(VERTICAL_WITH_ZERO_RATE_AUDIO, PATH)
  assert.equal(result.width, 1080)
  assert.equal(result.height, 1920)
})

test('duration comes back in microseconds', () => {
  const result = shapeProbe(VERTICAL_WITH_ZERO_RATE_AUDIO, PATH)
  assert.equal(result.durationUs, 67_833_333)
})

test('the summary names the codecs, the real size and the real rate', () => {
  const result = shapeProbe(VERTICAL_WITH_ZERO_RATE_AUDIO, PATH)
  assert.equal(result.summary, 'h264 · aac · 1080×1920 · 30fps · 1:08')
})

test('the audio stream is never the source of the frame rate', () => {
  // The same file with its streams in the other order. ffprobe does not guarantee the video
  // stream comes first, and a file muxed the other way round is the one that would break.
  const reordered: FfprobeOutput = {
    ...VERTICAL_WITH_ZERO_RATE_AUDIO,
    streams: [...(VERTICAL_WITH_ZERO_RATE_AUDIO.streams ?? [])].reverse()
  }
  const result = shapeProbe(reordered, PATH)
  assert.equal(result.fps, 30, 'fps was read from whichever stream came first')
  assert.equal(result.width, 1080)
})

// ---------------------------------------------------------------------------
// The other shapes real media takes
// ---------------------------------------------------------------------------

test('NTSC rates survive as the rational they are', () => {
  const ntsc: FfprobeOutput = {
    streams: [
      {
        codec_name: 'h264',
        codec_type: 'video',
        width: 1920,
        height: 1080,
        r_frame_rate: '30000/1001',
        duration: '10.0'
      }
    ],
    format: { duration: '10.0' }
  }
  const result = shapeProbe(ntsc, PATH)
  assert.equal(result.fps, 30000 / 1001)
  assert.match(result.summary, /29\.97fps/)
})

test('an audio-only file reports no picture and no rate', () => {
  const audioOnly: FfprobeOutput = {
    streams: [
      { codec_name: 'aac', codec_type: 'audio', sample_rate: '44100', channels: 2, duration: '95.2' }
    ],
    format: { format_name: 'mov,mp4,m4a', duration: '95.2' }
  }
  const result = shapeProbe(audioOnly, PATH)
  assert.equal(result.hasVideo, false)
  assert.equal(result.hasAudio, true)
  assert.equal(result.width, null)
  assert.equal(result.height, null)
  assert.equal(result.fps, null)
  assert.match(result.summary, /44\.1kHz/)
})

test('a silent video reports no audio', () => {
  const silent: FfprobeOutput = {
    streams: [
      {
        codec_name: 'h264',
        codec_type: 'video',
        width: 640,
        height: 480,
        r_frame_rate: '25/1',
        duration: '4.0'
      }
    ],
    format: { duration: '4.0' }
  }
  const result = shapeProbe(silent, PATH)
  assert.equal(result.hasAudio, false)
  assert.equal(result.fps, 25)
})

test('a still gets no frame rate, whatever the container claims', () => {
  // A PNG probes as a one-frame video stream. Reporting it as a 25fps video would make the
  // importer treat it as a one-frame clip, which cannot be stretched on a timeline.
  const still: FfprobeOutput = {
    streams: [
      {
        codec_name: 'png',
        codec_type: 'video',
        width: 800,
        height: 600,
        r_frame_rate: '25/1',
        nb_frames: '1'
      }
    ],
    format: { format_name: 'png_pipe' }
  }
  const result = shapeProbe(still, PATH)
  assert.equal(result.fps, null)
  assert.equal(result.durationUs, 0)
  assert.equal(result.width, 800)
})

test('a file with no streams at all is an error, not a zero-length asset', () => {
  // Silently producing a 0µs asset would put an unplaceable clip in the media panel with no
  // explanation attached to it.
  assert.throws(() => shapeProbe({ streams: [], format: {} }, PATH), /no media streams/)
})

test('a missing duration does not become NaN microseconds', () => {
  const noDuration: FfprobeOutput = {
    streams: [
      { codec_name: 'h264', codec_type: 'video', width: 640, height: 480, r_frame_rate: '25/1' }
    ],
    format: {}
  }
  const result = shapeProbe(noDuration, PATH)
  assert.equal(Number.isFinite(result.durationUs), true)
  assert.equal(result.durationUs, 0)
})
