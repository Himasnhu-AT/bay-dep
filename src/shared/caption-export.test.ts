/**
 * Exporting the timeline's captions as SRT.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captionsToSrt } from './caption-export'
import { cuesToFrames, parseSubtitles } from './captions'
import type { Asset, Project, Timeline } from './project'

const text = (id: string, words: string): Asset =>
  ({ id, kind: 'text', name: words, path: null, text: words }) as unknown as Asset

function timeline(): Timeline {
  const item = (id: string, assetId: string, from: number, duration: number) =>
    ({ id, assetId, from, durationInFrames: duration }) as never
  return {
    fps: 25,
    tracks: [
      // A title on an ordinary track is not a caption.
      { name: 'V2', items: [item('t', 'title', 0, 50)] },
      { name: 'Captions 2', items: [item('c3', 'c', 100, 25)] },
      { name: 'Captions', items: [item('c2', 'b', 50, 25), item('c1', 'a', 0, 50)] }
    ]
  } as unknown as Timeline
}

const project = { assets: [text('a', 'Hello there.'), text('b', 'Second line'), text('c', 'Third'), text('title', 'My Film')] } as Pick<
  Project,
  'assets'
>

test('captions export as numbered SRT cues in time order, and titles stay out', () => {
  assert.equal(
    captionsToSrt(project, timeline()),
    '1\n00:00:00,000 --> 00:00:02,000\nHello there.\n\n' +
      '2\n00:00:02,000 --> 00:00:03,000\nSecond line\n\n' +
      '3\n00:00:04,000 --> 00:00:05,000\nThird\n'
  )
})

test('what is exported imports back onto the same frames', () => {
  const srt = captionsToSrt(project, timeline())
  const parsed = parseSubtitles(srt ?? '')
  assert.ok(parsed.ok)
  assert.deepEqual(
    cuesToFrames(parsed.cues, 25).map((cue) => [cue.fromFrame, cue.toFrame, cue.text]),
    [
      [0, 50, 'Hello there.'],
      [50, 75, 'Second line'],
      [100, 125, 'Third']
    ]
  )
})

test('a timeline with no caption track has nothing to export', () => {
  const bare = { fps: 25, tracks: [{ name: 'V1', items: [] }] } as unknown as Timeline
  assert.equal(captionsToSrt(project, bare), null)
})
