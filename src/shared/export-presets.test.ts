/**
 * Export presets, the request they become, the aspect warning and the range. Run with `pnpm test`.
 *
 * The expected numbers are spelled out rather than read back from the presets: a test that took
 * its 1920×1080 from `EXPORT_PRESETS` would move with any edit to the preset it is checking.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_PRESETS,
  checkExportRange,
  exportAspectMismatch,
  exportRequestFields,
  fitCanvasInFrame,
  matchExportPreset,
  resolveExportRange,
  resolveExportSize,
  type ExportSettings
} from './export-presets'

const preset = (id: string): ExportSettings => {
  const found = EXPORT_PRESETS.find((candidate) => candidate.id === id)
  assert.ok(found, `no preset ${id}`)
  return found.settings
}

test('each preset reads as itself, and the default settings read as Custom', () => {
  for (const candidate of EXPORT_PRESETS) assert.equal(matchExportPreset(candidate.settings), candidate.id)
  // Positive control for the negative below: the matcher does not answer "custom" for everything.
  assert.equal(matchExportPreset(DEFAULT_EXPORT_SETTINGS), 'custom')
})

test('editing any field of a preset makes it Custom', () => {
  const youtube = preset('youtube-1080')
  assert.equal(matchExportPreset({ ...youtube, quality: 'best' }), 'custom')
  assert.equal(matchExportPreset({ ...youtube, format: 'mov' }), 'custom')
  assert.equal(matchExportPreset({ ...youtube, size: { kind: 'height', height: 1080 } }), 'custom')
  assert.equal(matchExportPreset({ ...youtube, loudness: 'off' }), 'custom')
  // Custom numbers equal to the streaming preset's are still custom numbers, not the preset.
  assert.equal(matchExportPreset({ ...youtube, loudness: { integratedLufs: -14, truePeakDb: -1 } }), 'custom')
  assert.equal(matchExportPreset({ ...youtube, loudness: { integratedLufs: -15, truePeakDb: -1 } }), 'custom')
})

test('an audio-only preset ignores the picture fields it greys out', () => {
  const podcast = preset('podcast')
  assert.equal(matchExportPreset({ ...podcast, quality: 'draft', size: { kind: 'height', height: 720 } }), 'podcast')
  assert.equal(matchExportPreset({ ...podcast, loudness: 'streaming' }), 'custom')
})

test('presets become the request main encodes', () => {
  assert.deepEqual(exportRequestFields(preset('youtube-1080'), 1920, 1080), {
    format: 'mp4',
    quality: 'good',
    width: 1920,
    height: 1080,
    loudness: { integratedLufs: -14, truePeakDb: -1 }
  })
  assert.deepEqual(exportRequestFields(preset('youtube-4k'), 1920, 1080), {
    format: 'mp4',
    quality: 'best',
    width: 3840,
    height: 2160,
    loudness: { integratedLufs: -14, truePeakDb: -1 }
  })
  // A platform preset is the platform's frame whatever the canvas.
  const vertical = exportRequestFields(preset('vertical'), 1920, 1080)
  assert.ok(!('error' in vertical))
  assert.deepEqual([vertical.width, vertical.height], [1080, 1920])
  // The master is the canvas, unmastered: no loudness key at all, which is what "off" means to main.
  assert.deepEqual(exportRequestFields(preset('master'), 2560, 1080), { format: 'mov', quality: 'best', width: 2560, height: 1080 })
  const podcast = exportRequestFields(preset('podcast'), 1920, 1080)
  assert.ok(!('error' in podcast))
  assert.equal(podcast.format, 'mp3')
  assert.deepEqual(podcast.loudness, { integratedLufs: -16, truePeakDb: -1 })
})

test('custom loudness passes through, and out-of-range numbers are refused with the range', () => {
  const custom = exportRequestFields({ ...DEFAULT_EXPORT_SETTINGS, loudness: { integratedLufs: -18, truePeakDb: -2 } }, 1920, 1080)
  assert.ok(!('error' in custom))
  assert.deepEqual(custom.loudness, { integratedLufs: -18, truePeakDb: -2 })
  const loud = exportRequestFields({ ...DEFAULT_EXPORT_SETTINGS, loudness: { integratedLufs: 3, truePeakDb: -1 } }, 1920, 1080)
  assert.ok('error' in loud)
  assert.match(loud.error, /-40 to -5/)
  // A PNG sequence has no audio, so a loudness choice is dropped rather than sent.
  const png = exportRequestFields({ ...DEFAULT_EXPORT_SETTINGS, format: 'png-sequence', loudness: 'streaming' }, 1920, 1080)
  assert.ok(!('error' in png))
  assert.equal('loudness' in png, false)
})

test('a height keeps the canvas shape and lands on even pixels', () => {
  assert.deepEqual(resolveExportSize({ kind: 'height', height: 720 }, 1920, 1080), { width: 1280, height: 720 })
  // 720 × 9/16 = 405, which H.264 cannot encode; it rounds to 406.
  assert.deepEqual(resolveExportSize({ kind: 'height', height: 720 }, 1080, 1920), { width: 406, height: 720 })
})

test('the aspect warning fires for a frame of another shape, and names where the bars go', () => {
  const onLandscape = exportAspectMismatch(preset('vertical'), 1920, 1080)
  assert.deepEqual(onLandscape, { frame: { width: 1080, height: 1920 }, bars: 'letterbox' })
  // A square frame is wider than a vertical canvas (bars at the sides) and taller than a
  // landscape one (bars above and below).
  assert.equal(exportAspectMismatch(preset('instagram-square'), 1080, 1920)?.bars, 'pillarbox')
  assert.equal(exportAspectMismatch(preset('instagram-square'), 1920, 1080)?.bars, 'letterbox')
  const landscapeOnVertical = exportAspectMismatch(preset('youtube-1080'), 1080, 1920)
  assert.equal(landscapeOnVertical?.bars, 'pillarbox')
  // Positive controls: the same shape at another size, the canvas's own size, and no picture.
  assert.equal(exportAspectMismatch(preset('youtube-4k'), 1920, 1080), null)
  assert.equal(exportAspectMismatch(preset('youtube-1080'), 1280, 720), null)
  assert.equal(exportAspectMismatch(preset('master'), 1080, 1920), null)
  assert.equal(exportAspectMismatch(preset('podcast'), 1080, 1920), null)
})

test('a canvas fits inside a frame of another shape whole and centred, one scale for both axes', () => {
  // 16:9 into 9:16: 1080 wide, so 0.5625 of 1920×1080 is 1080×607.5, centred in 1920 tall.
  const fit = fitCanvasInFrame(1920, 1080, 1080, 1920)
  assert.equal(fit.scale, 0.5625)
  assert.equal(fit.offsetX, 0)
  assert.equal(fit.offsetY, (1920 - 607.5) / 2)
  assert.deepEqual(fitCanvasInFrame(1920, 1080, 3840, 2160), { scale: 2, offsetX: 0, offsetY: 0 })
})

test('the whole timeline is frames 0 to duration − 1', () => {
  assert.deepEqual(resolveExportRange({ kind: 'whole' }, 300, { rangeIn: null, rangeOut: null }), { fromFrame: 0, toFrame: 299 })
})

test('In to Out: Out is exclusive, either mark may stand alone, and none is a sentence naming the keys', () => {
  const both = resolveExportRange({ kind: 'marks' }, 300, { rangeIn: 30, rangeOut: 90 })
  assert.deepEqual(both, { fromFrame: 30, toFrame: 89 }, 'Out is the first frame after the range')
  assert.deepEqual(resolveExportRange({ kind: 'marks' }, 300, { rangeIn: 30, rangeOut: null }), { fromFrame: 30, toFrame: 299 })
  assert.deepEqual(resolveExportRange({ kind: 'marks' }, 300, { rangeIn: null, rangeOut: 90 }), { fromFrame: 0, toFrame: 89 })
  const none = resolveExportRange({ kind: 'marks' }, 300, { rangeIn: null, rangeOut: null })
  assert.ok('error' in none)
  assert.match(none.error, /I and O/)
  // A mark at frame 0 is a mark, not an absence (the falsy-zero trap).
  assert.deepEqual(resolveExportRange({ kind: 'marks' }, 300, { rangeIn: 0, rangeOut: 60 }), { fromFrame: 0, toFrame: 59 })
})

test('a custom range is start to end-exclusive, and says what is wrong with a bad one', () => {
  // Two seconds at 30fps from 0:01:00 is 60 frames: 30 to 89.
  assert.deepEqual(resolveExportRange({ kind: 'custom', start: 30, end: 90 }, 300, { rangeIn: null, rangeOut: null }), {
    fromFrame: 30,
    toFrame: 89
  })
  const backwards = resolveExportRange({ kind: 'custom', start: 90, end: 30 }, 300, { rangeIn: null, rangeOut: null })
  assert.ok('error' in backwards)
  assert.match(backwards.error, /after the start/)
  const unparsed = resolveExportRange({ kind: 'custom', start: null, end: 30 }, 300, { rangeIn: null, rangeOut: null })
  assert.ok('error' in unparsed)
  assert.match(unparsed.error, /0:02:00/)
  const past = resolveExportRange({ kind: 'custom', start: 400, end: 500 }, 300, { rangeIn: null, rangeOut: null })
  assert.ok('error' in past)
  assert.match(past.error, /past the end of the timeline \(300 frames\)/)
})

test("export_timeline's range: inclusive, defaults to the whole timeline, the end clamped to the last frame", () => {
  assert.deepEqual(checkExportRange(undefined, undefined, 120), { fromFrame: 0, toFrame: 119 })
  assert.deepEqual(checkExportRange(10, 20, 120), { fromFrame: 10, toFrame: 20 })
  assert.deepEqual(checkExportRange(100, 500, 120), { fromFrame: 100, toFrame: 119 })
  const reversed = checkExportRange(20, 10, 120)
  assert.ok('error' in reversed)
  assert.match(reversed.error, /toFrame \(10\) is before fromFrame \(20\)/)
  const garbage = checkExportRange(Number('abc'), undefined, 120)
  assert.ok('error' in garbage)
  const empty = checkExportRange(undefined, undefined, 0)
  assert.ok('error' in empty)
  assert.match(empty.error, /empty/)
})
