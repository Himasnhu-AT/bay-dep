/**
 * SRT and WebVTT parsing, frame conversion, and the one-track checks.
 *
 * The fixtures are written the way real files are, not the way the spec draws them: CRLF line
 * ends, a byte-order mark, cue numbers, VTT headers with metadata, NOTE and STYLE blocks, cue
 * settings after the end time, voice spans and SSA override tags. A parser tested only on the
 * tidy form passes here and fails on the first file a person exports from anything.
 *
 * Every refusal is asserted on its content — the line it names and what would fix it — and is
 * paired with the nearest input that parses.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  captionLayout,
  captionStyle,
  checkCues,
  cuesToFrames,
  formatTimestamp,
  parseSubtitles,
  parseTimestamp,
  type CaptionCue,
  type SubtitleParse
} from './captions'
import { usToFrames } from './project'

function parsed(source: string): Extract<SubtitleParse, { ok: true }> {
  const result = parseSubtitles(source)
  if (!result.ok) assert.fail(`expected it to parse, but: ${result.error}`)
  return result
}

function refused(source: string): string {
  const result = parseSubtitles(source)
  if (result.ok) assert.fail('expected the subtitles to be refused')
  return result.error
}

// ---------------------------------------------------------------------------
// timestamps
// ---------------------------------------------------------------------------

test('both timestamp forms, and both separators, read as the same time', () => {
  const expected = ((1 * 60 + 2) * 60 + 3) * 1_000_000 + 456_000
  assert.equal(parseTimestamp('01:02:03,456'), expected)
  assert.equal(parseTimestamp('01:02:03.456'), expected)
  assert.equal(parseTimestamp('62:03.456'), null, 'minutes past 59 without hours is a typo, not an hour')
  assert.equal(parseTimestamp('02:03.456'), (2 * 60 + 3) * 1_000_000 + 456_000, 'VTT may omit hours')
  assert.equal(parseTimestamp('100:00:00.000'), 100 * 3600 * 1_000_000, 'hours are not capped')
})

test('the fraction is a decimal fraction: ",5" is half a second, not five milliseconds', () => {
  assert.equal(parseTimestamp('00:00:01,5'), 1_500_000)
  assert.equal(parseTimestamp('00:00:01,05'), 1_050_000)
  assert.equal(parseTimestamp('00:00:01,005'), 1_005_000)
})

test('malformed timestamps are refused rather than guessed', () => {
  for (const bad of ['00:75:00,000', '00:00:61,000', '1:2:3', '00:00:01', '00:00:01:000', 'abc', '', '00:00:01,0000']) {
    assert.equal(parseTimestamp(bad), null, JSON.stringify(bad))
  }
})

test('formatTimestamp reads back what parseTimestamp read', () => {
  assert.equal(formatTimestamp(parseTimestamp('01:02:03,456')!), '01:02:03.456')
  assert.equal(formatTimestamp(0), '00:00:00.000')
})

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

const SRT =
  '\uFEFF1\r\n' +
  '00:00:01,000 --> 00:00:03,500\r\n' +
  'Hello there.\r\n' +
  '\r\n' +
  '2\r\n' +
  '00:00:04,000 --> 00:00:06,000\r\n' +
  '{\\an8}<i>Two lines,</i>\r\n' +
  'Tom &amp; Jerry.\r\n' +
  '\r\n'

test('an SRT file with a BOM, CRLF, numbers, tags and entities yields just the words and times', () => {
  assert.equal(SRT.charCodeAt(0), 0xfeff, 'the specimen must really start with a byte-order mark')
  assert.ok(SRT.includes('\r\n'), 'and really use CRLF')
  const result = parsed(SRT)
  assert.equal(result.format, 'srt')
  assert.equal(result.cues.length, 2)
  assert.deepEqual(result.cues[0], { startUs: 1_000_000, endUs: 3_500_000, text: 'Hello there.', line: 2 })
  assert.equal(result.cues[1]!.text, 'Two lines,\nTom & Jerry.', 'lines kept, markup gone, entities decoded')
  assert.equal(result.cues[1]!.line, 6)
})

test('a file with bare carriage returns for line ends parses like any other', () => {
  const classicMac = '1\r00:00:01,000 --> 00:00:02,000\rOne\r\r2\r00:00:03,000 --> 00:00:04,000\rTwo\r'
  assert.equal(classicMac.includes('\n'), false, 'the specimen must have no line feeds at all')
  assert.deepEqual(parsed(classicMac).cues.map((c) => c.text), ['One', 'Two'])
})

test('a cue with no text is dropped and counted rather than refused', () => {
  const result = parsed('1\n00:00:01,000 --> 00:00:02,000\n<i></i>\n\n2\n00:00:03,000 --> 00:00:04,000\nKept\n')
  assert.equal(result.cues.length, 1)
  assert.equal(result.droppedEmpty, 1)
  assert.equal(result.cues[0]!.text, 'Kept')
})

test('a block with no timing line is refused naming the line it starts on', () => {
  const message = refused('1\n00:00:01,000 --> 00:00:02,000\nFine\n\n2\nno timing here\n')
  assert.match(message, /^Line 5 starts a block with no timing line/)
  assert.match(message, /00:00:01,000 --> 00:00:03,500/, 'and shows what one looks like')
})

test('an unreadable timestamp is refused naming its line and the text it could not read', () => {
  const message = refused('1\n00:00:01,000 --> 00:00:02,000\nFine\n\n2\n00:00:03,000 --> 00:61:00,000\nBad\n')
  assert.match(message, /Line 6 has a timestamp bay cannot read: "00:61:00,000"/)
})

test('a cue that ends before it starts is refused with both times', () => {
  const message = refused('1\n00:00:05,000 --> 00:00:04,000\nBackwards\n')
  assert.match(message, /line 2 ends at 00:00:04\.000, which is not after it starts at 00:00:05\.000/)
  parsed('1\n00:00:04,000 --> 00:00:05,000\nForwards\n')
})

test('an empty document, and one whose every cue is empty, are refused as having nothing to place', () => {
  assert.match(refused('  \n\n'), /empty/)
  assert.match(refused('WEBVTT\n\nNOTE nothing but a comment\n'), /No cues were found/)
  assert.match(refused('1\n00:00:01,000 --> 00:00:02,000\n<b> </b>\n'), /The only cue is empty/)
  assert.match(
    refused('1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\n<i></i>\n'),
    /All 2 cues are empty/
  )
})

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

const VTT = [
  'WEBVTT - an interview',
  'Kind: captions',
  'Language: en',
  '',
  'STYLE',
  '::cue { color: yellow }',
  '',
  'NOTE this line is a comment',
  'and so is this one --> even with an arrow',
  '',
  'intro',
  '00:01.000 --> 00:02.500 align:start position:10%',
  '<v Anna>Welcome <c.loud>back</c>.',
  '',
  '00:00:03.000 --> 00:00:04.000',
  '<00:00:03.500>Karaoke timing is dropped',
  ''
].join('\n')

test('a WebVTT file skips its header, STYLE and NOTE blocks, cue ids and cue settings', () => {
  const result = parsed(VTT)
  assert.equal(result.format, 'vtt')
  assert.deepEqual(
    result.cues.map((c) => [c.startUs, c.endUs, c.text]),
    [
      [1_000_000, 2_500_000, 'Welcome back.'],
      [3_000_000, 4_000_000, 'Karaoke timing is dropped']
    ]
  )
  assert.equal(result.cues[0]!.line, 12)
})

test('a NOTE block is only skipped in WebVTT — in SRT a stray block is still an error', () => {
  assert.match(refused('NOTE something\n\n1\n00:00:01,000 --> 00:00:02,000\nx\n'), /Line 1 starts a block/)
})

// ---------------------------------------------------------------------------
// frames
// ---------------------------------------------------------------------------

test('cues become frames through the model conversion, at the timeline rate', () => {
  const cues = parsed(SRT).cues
  for (const fps of [24, 25, 30, 30000 / 1001, 60]) {
    const framed = cuesToFrames(cues, fps)
    assert.equal(framed[0]!.fromFrame, usToFrames(1_000_000, fps), `${fps}`)
    assert.equal(framed[0]!.toFrame, usToFrames(3_500_000, fps), `${fps}`)
    assert.equal(framed[1]!.where, 'line 6')
  }
  assert.deepEqual(
    cuesToFrames(cues, 25).map((c) => [c.fromFrame, c.toFrame]),
    [
      [25, 88],
      [100, 150]
    ]
  )
})

test('cues that abut in the file still abut in frames, and pass the check', () => {
  const framed = cuesToFrames(
    parsed('1\n00:00:01,000 --> 00:00:02,037\na\n\n2\n00:00:02,037 --> 00:00:03,000\nb\n').cues,
    30
  )
  assert.equal(framed[0]!.toFrame, framed[1]!.fromFrame)
  assert.equal(checkCues(framed, 30), null)
})

test('a sub-frame overlap in the file rounds onto one frame and is accepted', () => {
  // Rolling auto-captions overlap by a few milliseconds all the time. After rounding they meet
  // on the same frame, which one track can hold.
  const framed = cuesToFrames(
    parsed('1\n00:00:01,000 --> 00:00:02,010\na\n\n2\n00:00:02,000 --> 00:00:03,000\nb\n').cues,
    30
  )
  assert.ok(framed[0]!.toFrame <= framed[1]!.fromFrame)
  assert.equal(checkCues(framed, 30), null)
})

// ---------------------------------------------------------------------------
// the one-track check
// ---------------------------------------------------------------------------

const cue = (fromFrame: number, toFrame: number, text = 'x', where?: string): CaptionCue => ({
  fromFrame,
  toFrame,
  text,
  ...(where ? { where } : {})
})

test('overlapping cues are refused naming both, by how much, and the frames that would fix it', () => {
  const message = checkCues([cue(0, 30, 'first'), cue(90, 150, 'Hello there'), cue(140, 200, 'General Kenobi')], 30)
  assert.ok(message)
  assert.match(message, /cue 2, frames 90-150 "Hello there" overlaps cue 3, frames 140-200 "General Kenobi" by 10 frames/)
  assert.match(message, /end the first at frame 140, or start the second at 150/)

  // The nearest legal set: the same cues, the second ended where the third begins.
  assert.equal(checkCues([cue(0, 30), cue(90, 140), cue(140, 200)], 30), null)
})

test('an overlap is found whatever order the cues arrive in, and named by their given position', () => {
  const message = checkCues([cue(140, 200, 'late'), cue(0, 30, 'early'), cue(90, 150, 'middle')], 30)
  assert.match(message ?? '', /cue 3, frames 90-150 "middle" overlaps cue 1, frames 140-200 "late"/)
})

test('a message about a file cue names its line', () => {
  const message = checkCues([cue(0, 50, 'a', 'line 2'), cue(40, 60, 'b', 'line 6')], 30)
  assert.match(message ?? '', /cue 1 \(line 2\).*cue 2 \(line 6\)/)
})

test('a cue shorter than a frame is refused naming the rate, and a one-frame cue is accepted', () => {
  assert.match(checkCues([cue(10, 10)], 29.97002997) ?? '', /shorter than one frame at 29\.97fps/)
  assert.equal(checkCues([cue(10, 11)], 30), null)
})

test('backwards, negative, fractional and empty cues are each refused by name', () => {
  assert.match(checkCues([cue(10, 5)], 30) ?? '', /ends before it starts/)
  assert.match(checkCues([cue(-3, 5)], 30) ?? '', /starts before frame 0/)
  assert.match(checkCues([cue(1.5, 5)], 30) ?? '', /not a whole number/)
  assert.match(checkCues([cue(1, 5, '  ')], 30) ?? '', /has no text/)
  assert.match(checkCues([], 30) ?? '', /No cues were given/)
})

// ---------------------------------------------------------------------------
// look
// ---------------------------------------------------------------------------

test('the caption band sits inside the frame, in its lower part, with words anchored to its bottom', () => {
  for (const frame of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    const box = captionLayout(frame)
    assert.ok(box.left > 0 && box.left + box.width < frame.width, 'inset from both sides')
    assert.ok(box.top > frame.height / 2 && box.top + box.height < frame.height, 'in the lower half, clear of the edge')
    const style = captionStyle(frame)
    assert.equal(style.verticalAlign, 'bottom')
    assert.ok(style.background, 'a plate, so the words read over any footage')
    assert.equal(style.fontSize, Math.round(frame.height * 0.05), 'sized to the frame height')
  }
})
