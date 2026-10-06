import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTrackMove, trackNumber, trackNumbers } from './track-order'
import type { Track } from './project'

const track = (id: string, kind: Track['kind'], name: string): Track => ({
  id, kind, name, locked: false, muted: false, hidden: false, items: []
})

/** Interleaved on purpose: the array order between kinds means nothing and must be left alone. */
const tracks = (): Track[] => [
  track('v1', 'video', 'V1'),
  track('a1', 'audio', 'A1'),
  track('v2', 'video', 'Titles'),
  track('v3', 'video', 'V3'),
  track('a2', 'audio', 'A2')
]
const order = (list: readonly Track[]): string => list.map((t) => `${t.id}:${t.name}`).join(' ')

test('a track’s number is its place among tracks of its kind, whatever sits between them', () => {
  assert.deepEqual([...trackNumbers(tracks())], [['v1', 'V1'], ['a1', 'A1'], ['v2', 'V2'], ['v3', 'V3'], ['a2', 'A2']])
  assert.equal(trackNumber(tracks(), 'v3'), 'V3')
  assert.equal(trackNumber(tracks(), 'nope'), undefined)
})

test('moving a video track permutes video tracks only; audio keeps its slots', () => {
  const plan = planTrackMove({ tracks: tracks() }, 'v1', 3)
  assert.ok('tracks' in plan)
  // v1 goes to the top of the video stack. V3 was named by its number and is now V2; "Titles"
  // was named by a person and keeps its name; v1 takes the number it moved to.
  assert.equal(order(plan.tracks), 'v2:Titles a1:A1 v3:V2 v1:V3 a2:A2')
  assert.deepEqual(plan.moved, {
    trackId: 'v1', kind: 'video', from: 1, to: 3,
    renamed: [{ trackId: 'v3', was: 'V3', now: 'V2' }, { trackId: 'v1', was: 'V1', now: 'V3' }]
  })
})

test('moving down as well as up, and audio among audio', () => {
  const down = planTrackMove({ tracks: tracks() }, 'v3', 1)
  assert.ok('tracks' in down)
  assert.equal(order(down.tracks), 'v3:V1 a1:A1 v1:V2 v2:Titles a2:A2')
  const audio = planTrackMove({ tracks: tracks() }, 'a2', 1)
  assert.ok('tracks' in audio)
  assert.equal(order(audio.tracks), 'v1:V1 a2:A1 v2:Titles v3:V3 a1:A2')
})

test('a move never edits the tracks it was given, and carries each track’s clips with it', () => {
  const given = tracks()
  given[0]!.items = [{ id: 'itm' } as Track['items'][number]]
  const before = structuredClone(given)
  const plan = planTrackMove({ tracks: given }, 'v1', 2)
  assert.ok('tracks' in plan)
  assert.deepEqual(given, before)
  assert.deepEqual(plan.tracks.find((t) => t.id === 'v1')!.items, [{ id: 'itm' }])
})

test('a name that only looks like a number — “V3” on the first video track — is a chosen name and stays', () => {
  const list = [track('x', 'video', 'V3'), track('y', 'video', 'V2')]
  const plan = planTrackMove({ tracks: list }, 'x', 2)
  assert.ok('tracks' in plan)
  // y was "V2" at place 2: its number. x was "V3" at place 1: not its number.
  assert.equal(order(plan.tracks), 'y:V1 x:V3')
})

test('refusals say what exists: an unknown track, a place that is not there, the place it is in', () => {
  const unknown = planTrackMove({ tracks: tracks() }, 'ghost', 1)
  assert.ok('error' in unknown)
  assert.match(unknown.error, /No track has the id "ghost"\. The tracks are: v1 \(V1, “V1”\); a1 \(A1, “A1”\); v2 \(V2, “Titles”\)/)

  for (const position of [0, 4, 1.5, Number.NaN]) {
    const out = planTrackMove({ tracks: tracks() }, 'v2', position)
    assert.ok('error' in out, `position ${position}`)
    assert.match(out.error, /this timeline has 3 video tracks, so position runs from 1 \(V1, drawn lowest\) to 3\. “Titles” is at 2\./)
  }
  // The pair for the range: both ends of it are legal.
  assert.ok('tracks' in planTrackMove({ tracks: tracks() }, 'v2', 1))
  assert.ok('tracks' in planTrackMove({ tracks: tracks() }, 'v2', 3))

  const same = planTrackMove({ tracks: tracks() }, 'v2', 2)
  assert.ok('error' in same)
  assert.match(same.error, /“Titles” is already V2\. Nothing was moved\./)

  const only = planTrackMove({ tracks: [track('v', 'video', 'V1'), track('a', 'audio', 'A1')] }, 'a', 2)
  assert.ok('error' in only)
  assert.match(only.error, /“A1” is the only audio track.*add_track/)
})
