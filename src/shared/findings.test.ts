import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DURATION_TOLERANCE, durationToleranceUs, exportFindings, hasBlocking, transcriptFindings, type DeliveredFile } from './findings'

const GOOD: DeliveredFile = { sizeBytes: 1_000_000, hasVideo: true, hasAudio: true, durationUs: 10_000_000 }
const VIDEO_WITH_SOUND = { video: true, audio: true, durationUs: 10_000_000, fps: 30 }

test('a clean export has no findings — the positive control for every refusal below', () => {
  assert.deepEqual(exportFindings(GOOD, VIDEO_WITH_SOUND), [])
  // Silent timeline, silent file: nothing to report either.
  assert.deepEqual(exportFindings({ ...GOOD, hasAudio: false }, { ...VIDEO_WITH_SOUND, audio: false }), [])
  // Audio-only export: no video expected, none there.
  assert.deepEqual(exportFindings({ ...GOOD, hasVideo: false }, { ...VIDEO_WITH_SOUND, video: false }), [])
})

test('a missing or empty file is blocking, and says so rather than checking streams', () => {
  const missing = exportFindings(null, VIDEO_WITH_SOUND)
  assert.equal(missing.length, 1)
  assert.equal(missing[0]!.severity, 'blocking')
  assert.match(missing[0]!.message, /no file/)
  const empty = exportFindings({ ...GOOD, sizeBytes: 0 }, VIDEO_WITH_SOUND)
  assert.match(empty[0]!.message, /0 bytes/)
  assert.ok(empty[0]!.fix)
})

test('a file that cannot be read back is blocking with the prober’s own words', () => {
  const found = exportFindings(GOOD, VIDEO_WITH_SOUND, 'moov atom not found')
  assert.equal(found.length, 1)
  assert.match(found[0]!.message, /moov atom not found/)
})

test('sound on the timeline and none in the file is blocking', () => {
  const found = exportFindings({ ...GOOD, hasAudio: false }, VIDEO_WITH_SOUND)
  assert.equal(found.length, 1)
  assert.equal(found[0]!.severity, 'blocking')
  assert.match(found[0]!.message, /no audio stream/)
})

test('no video stream in a video export is blocking', () => {
  const found = exportFindings({ ...GOOD, hasVideo: false }, VIDEO_WITH_SOUND)
  assert.equal(found.length, 1)
  assert.match(found[0]!.message, /no video stream/)
})

test('duration is checked at 2%, both sides of the bound', () => {
  assert.equal(DURATION_TOLERANCE, 0.02)
  // 1.9% short: inside. 2.1% short and 2.1% long: outside.
  assert.deepEqual(exportFindings({ ...GOOD, durationUs: 9_810_000 }, VIDEO_WITH_SOUND), [])
  const short = exportFindings({ ...GOOD, durationUs: 9_790_000 }, VIDEO_WITH_SOUND)
  assert.equal(short.length, 1)
  assert.match(short[0]!.message, /9\.79s long; the range exported is 10\.00s/)
  assert.equal(exportFindings({ ...GOOD, durationUs: 10_210_000 }, VIDEO_WITH_SOUND).length, 1)
  // An unmeasurable length is a warning, not a pass and not a block.
  const unknown = exportFindings({ ...GOOD, durationUs: null }, VIDEO_WITH_SOUND)
  assert.equal(unknown[0]!.severity, 'warn')
  assert.equal(hasBlocking(unknown), false)
})

test('a short export may run a frame plus 20 ms long, which is more than 2% of it', () => {
  // Six frames at 30 fps: 200 ms. WebM/Opus priming adds ~8 ms — 4%, and not a wrong file.
  const short = { video: true, audio: true, durationUs: 200_000, fps: 30 }
  assert.deepEqual(exportFindings({ ...GOOD, durationUs: 208_000 }, short), [])
  // Up to one frame (33.3 ms) + 20 ms either way is inside…
  assert.deepEqual(exportFindings({ ...GOOD, durationUs: 253_000 }, short), [])
  assert.deepEqual(exportFindings({ ...GOOD, durationUs: 147_000 }, short), [])
  // …and past it is still blocking: the slack does not swallow a real fault.
  assert.equal(exportFindings({ ...GOOD, durationUs: 254_000 }, short)[0]?.severity, 'blocking')
  assert.equal(exportFindings({ ...GOOD, durationUs: 300_000 }, short)[0]?.severity, 'blocking')
  // A long export is still held to 2%, not loosened to a frame.
  assert.equal(durationToleranceUs(VIDEO_WITH_SOUND), 200_000)
})

test('several faults are all reported', () => {
  const found = exportFindings({ ...GOOD, hasVideo: false, hasAudio: false, durationUs: 1_000_000 }, VIDEO_WITH_SOUND)
  assert.equal(found.length, 3)
  assert.ok(hasBlocking(found))
})

test('a transcript with no lines, or lines with no words, is blocking', () => {
  assert.equal(transcriptFindings([])[0]!.severity, 'blocking')
  const blank = transcriptFindings([{ startSeconds: 0, endSeconds: 1, text: '  ' }, { startSeconds: 1, endSeconds: 2, text: '' }])
  assert.equal(blank.length, 1)
  assert.match(blank[0]!.message, /2 lines and no words/)
})

test('a transcript with words passes, and warns when the clip plays none of them', () => {
  const said = [{ startSeconds: 0, endSeconds: 1, text: ' Hello there.' }]
  assert.deepEqual(transcriptFindings(said), [])
  assert.deepEqual(transcriptFindings(said, 3), [])
  const unplayed = transcriptFindings(said, 0)
  assert.equal(unplayed[0]!.severity, 'warn')
  assert.match(unplayed[0]!.message, /none of it falls inside/)
})
