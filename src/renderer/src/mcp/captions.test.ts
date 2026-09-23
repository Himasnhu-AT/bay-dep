/**
 * `add_captions` through the catalog schema, the handler and the store.
 *
 * Held still: a caption file lands as one undo step on a new track above every other; a
 * refusal places nothing at all and names the cues that caused it; identical lines share an
 * asset; and the frames an SRT lands on come from the timeline's own rate.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { usToFrames, type Item, type Timeline } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { validateArgs } from './validate'
import { addCaptions } from './captions'
import { ToolError } from './helpers'

function load(fps = 30): void {
  const project = emptyProject()
  project.timelines[0]!.fps = fps
  useEditor.getState().setProject(project)
}

function call(args: Record<string, unknown>): Record<string, unknown> {
  const spec = findTool('add_captions')
  assert.ok(spec, 'add_captions must be in the catalog')
  const invalid = validateArgs(spec, args)
  if (invalid) throw new ToolError(invalid)
  return addCaptions(args)
}

function refusal(args: Record<string, unknown>): string {
  try {
    call(args)
  } catch (error) {
    if (error instanceof ToolError) return error.message
    throw error
  }
  assert.fail(`expected ${JSON.stringify(args).slice(0, 120)} to be refused`)
}

const timeline = (): Timeline => useEditor.getState().project.timelines[0]!
const past = (): number => useEditor.getState().past.length
const snapshot = (): string => JSON.stringify(useEditor.getState().project)

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:02,500',
  'First line.',
  '',
  '2',
  '00:00:02,500 --> 00:00:04,000',
  '[music]',
  '',
  '3',
  '00:00:05,000 --> 00:00:06,000',
  '[music]',
  ''
].join('\n')

test('an SRT lands as one undo step, on a new track above every other video track', () => {
  load()
  const tracksBefore = timeline().tracks.length
  const before = past()
  const result = call({ srt: SRT })

  assert.equal(past(), before + 1, 'a whole caption file is one undo step')
  assert.equal(timeline().tracks.length, tracksBefore + 1)
  const videoTracks = timeline().tracks.filter((t) => t.kind === 'video')
  const top = videoTracks[videoTracks.length - 1]!
  assert.equal(top.id, result.trackId, 'the caption track must be the topmost video track')
  assert.equal(top.name, 'Captions')
  assert.equal(result.format, 'srt')
  assert.deepEqual(
    top.items.map((i) => [i.from, i.durationInFrames]),
    [
      [30, 45],
      [75, 45],
      [150, 30]
    ]
  )

  useEditor.getState().undo()
  assert.equal(timeline().tracks.length, tracksBefore, 'undo takes the whole thing back')
  assert.equal(useEditor.getState().project.assets.length, 0, 'including the text assets')
})

test('repeated lines share one text asset, and every caption draws its own words', () => {
  load()
  const result = call({ srt: SRT })
  assert.equal(result.captions, 3)
  assert.equal(result.textAssets, 2, '"[music]" twice is one asset placed twice')
  const { assets } = useEditor.getState().project
  const top = timeline().tracks.find((t) => t.id === result.trackId)!
  assert.deepEqual(
    top.items.map((i) => assets.find((a) => a.id === i.assetId)?.text),
    ['First line.', '[music]', '[music]']
  )
})

test('SRT times land on the timeline rate, through the model conversion', () => {
  load(25)
  const result = call({ srt: SRT })
  const first = timeline().tracks.find((t) => t.id === result.trackId)!.items[0]!
  assert.equal(first.from, usToFrames(1_000_000, 25))
  assert.equal(first.durationInFrames, usToFrames(2_500_000, 25) - usToFrames(1_000_000, 25))
})

test('overlapping cues place nothing, and the refusal names both cues and the fix', () => {
  load()
  const before = snapshot()
  const message = refusal({
    cues: [
      { fromFrame: 0, toFrame: 60, text: 'one' },
      { fromFrame: 50, toFrame: 90, text: 'two' }
    ]
  })
  assert.match(message, /cue 1 \(cues\[0\]\), frames 0-60 "one" overlaps cue 2 \(cues\[1\]\), frames 50-90 "two" by 10 frames/)
  assert.match(message, /end the first at frame 50, or start the second at 60/)
  assert.equal(snapshot(), before, 'a refused call leaves the project untouched — no track, no assets')

  // The nearest legal call: the same cues, abutting.
  call({
    cues: [
      { fromFrame: 0, toFrame: 50, text: 'one' },
      { fromFrame: 50, toFrame: 90, text: 'two' }
    ]
  })
})

test('an overlap in an SRT names the lines it is on', () => {
  load()
  const message = refusal({
    srt: '1\n00:00:01,000 --> 00:00:03,000\na\n\n2\n00:00:02,000 --> 00:00:04,000\nb\n'
  })
  assert.match(message, /cue 1 \(line 2\).*overlaps cue 2 \(line 6\)/)
})

test('a malformed cue is refused by index before anything is placed', () => {
  load()
  assert.match(
    refusal({ cues: [{ fromFrame: 0, toFrame: 30, text: 'ok' }, { fromFrame: 1.5, toFrame: 30, text: 'x' }] }),
    /cues\[1\]\.fromFrame must be a whole number of frames/
  )
  assert.match(refusal({ cues: [{ from: 0, toFrame: 30, text: 'x' }] }), /cues\[0\] has no field "from"/)
  assert.match(refusal({ cues: [{ fromFrame: 0, toFrame: 30, text: 7 }] }), /cues\[0\]\.text must be a string/)
  assert.match(refusal({ cues: ['hello'] }), /cues\[0\] must be an object/)
  assert.equal(past(), 0)
})

test('exactly one of cues and srt: both, or neither, is refused saying which to pass', () => {
  load()
  assert.match(refusal({}), /pass "cues" as \[\{ fromFrame, toFrame, text \}\], or "srt"/)
  assert.match(refusal({ cues: [], srt: SRT }), /either "cues" or "srt", not both/)
  assert.match(refusal({ cues: [] }), /No cues were given/)
})

test('offsetFrames shifts every cue, and one pushed before frame 0 is refused', () => {
  load()
  const result = call({ srt: SRT, offsetFrames: 300 })
  assert.equal(result.fromFrame, 330)
  load()
  assert.match(refusal({ srt: SRT, offsetFrames: -40 }), /starts before frame 0/)
  call({ srt: SRT, offsetFrames: -30 })
})

test('style merges over the caption look for every caption, and a bad field is refused', () => {
  load()
  const result = call({ srt: SRT, style: { color: '#ffcc00', fontSize: 40 } })
  const items: Item[] = timeline().tracks.find((t) => t.id === result.trackId)!.items
  for (const item of items) {
    assert.equal(item.text?.color, '#FFCC00')
    assert.equal(item.text?.fontSize, 40)
    assert.equal(item.text?.verticalAlign, 'bottom', 'unset fields keep the caption default')
  }
  // Each caption owns its style: editing one must not reach the others through a shared object.
  assert.notEqual(items[0]!.text, items[1]!.text)

  load()
  assert.match(refusal({ srt: SRT, style: { fontWeight: 550 } }), /multiple of 100/)
})

test('a second caption set gets its own track, named so the two can be told apart', () => {
  load()
  call({ srt: SRT })
  const second = call({ srt: SRT })
  assert.equal(second.trackName, 'Captions 2')
})
