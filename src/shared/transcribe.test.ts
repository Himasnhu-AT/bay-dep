/**
 * Transcript parsing and mapping. Run with `pnpm test`. The fixture is real whisper.cpp output
 * (`whisper-cli -oj -ml 42 -sow` on its bundled jfk.wav), not a shape written from memory.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseWhisperJson, segmentsToCues, segmentsToSrt } from './transcribe'

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures-whisper-jfk.json'), 'utf8'))

test('real whisper.cpp output parses into trimmed, timed lines', () => {
  const segments = parseWhisperJson(fixture)
  assert.deepEqual(segments, [
    { startSeconds: 0, endSeconds: 5.41, text: 'And so my fellow Americans, ask not what' },
    { startSeconds: 5.41, endSeconds: 9.04, text: 'your country can do for you, ask what you' },
    { startSeconds: 9.04, endSeconds: 11, text: 'can do for your country.' }
  ])
})

test('silence tags and empty or broken rows are dropped, not captioned', () => {
  const segments = parseWhisperJson({
    transcription: [
      { offsets: { from: 0, to: 1000 }, text: ' [BLANK_AUDIO]' },
      { offsets: { from: 1000, to: 2000 }, text: '   ' },
      { offsets: { from: 3000, to: 2000 }, text: 'backwards' },
      { offsets: { from: 2000, to: 3000 }, text: ' kept' }
    ]
  })
  assert.deepEqual(segments.map((s) => s.text), ['kept'])
  assert.deepEqual(parseWhisperJson({ nope: true }), [])
})

test('a clip placed at its source start maps lines straight across', () => {
  const cues = segmentsToCues(parseWhisperJson(fixture), { from: 0, durationInFrames: 330, sourceStartUs: 0, speed: 1 }, 30)
  assert.deepEqual(cues.map((c) => [c.fromFrame, c.toFrame]), [[0, 162], [162, 271], [271, 330]])
})

test('a clip playing the middle of the file, later on the timeline, shifts and clips the lines', () => {
  // Starts 5 s into the file, sits at frame 100, runs 4 s: shows 5–9 s of the source.
  const cues = segmentsToCues(
    parseWhisperJson(fixture),
    { from: 100, durationInFrames: 120, sourceStartUs: 5_000_000, speed: 1 },
    30
  )
  // Line 1 (0–5.41 s) shows only its last 0.41 s; line 2 fits; line 3 starts after the out point.
  assert.deepEqual(cues, [
    { fromFrame: 100, toFrame: 112, text: 'And so my fellow Americans, ask not what' },
    { fromFrame: 112, toFrame: 220, text: 'your country can do for you, ask what you' }
  ])
})

test('speed scales the timing: at 2x a line takes half the frames', () => {
  const cues = segmentsToCues(
    [{ startSeconds: 0, endSeconds: 2, text: 'two seconds' }],
    { from: 0, durationInFrames: 300, sourceStartUs: 0, speed: 2 },
    30
  )
  assert.deepEqual(cues, [{ fromFrame: 0, toFrame: 30, text: 'two seconds' }])
})

test('SRT output uses whisper-style timestamps and 1-based numbering', () => {
  const srt = segmentsToSrt(parseWhisperJson(fixture))
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:05,410\nAnd so my fellow Americans, ask not what\n/)
  assert.match(srt, /3\n00:00:09,040 --> 00:00:11,000\ncan do for your country\.\n$/)
})

test('lines whose rounded frames would overlap are made to abut, never overlap', () => {
  // whisper can start a line a hair before the last one ends; at 30 fps 5.45 s rounds to frame
  // 164 and 5.44 s to 163, so the raw mapping would overlap by a frame.
  const segments = [
    { startSeconds: 5.0, endSeconds: 5.45, text: 'first' },
    { startSeconds: 5.44, endSeconds: 6.0, text: 'second' }
  ]
  const clip = { from: 0, durationInFrames: 300, sourceStartUs: 0, speed: 1 }
  assert.ok(Math.round(5.44 * 30) < Math.round(5.45 * 30), 'specimen: the raw frames do overlap')
  const cues = segmentsToCues(segments, clip, 30)
  assert.deepEqual(
    cues.map((c) => [c.fromFrame, c.toFrame]),
    [[150, 164], [164, 180]]
  )
})
