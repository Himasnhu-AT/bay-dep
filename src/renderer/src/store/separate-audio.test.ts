/**
 * A placed video's sound on its own linked clip on an audio track (Preferences › Editing, on by
 * default), as in Resolve — and the edits that must treat the pair as one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { emptyProject, selectTimeline, useEditor } from './editor'
import { useEditingPrefs } from './editing-prefs'
import { runSourceEdit, useSourceClip } from '@/editor/timeline/sourceEdits'

globalThis.requestAnimationFrame ??= () => 0

const state = () => useEditor.getState()
const tracks = () => selectTimeline(state())!.tracks

function asset(id: string, fields: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'video', name: `${id}.mp4`, path: `/f/${id}`, durationUs: 2_000_000, width: 1920, height: 1080, fps: 30,
    hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 1, ...fields
  }
}

function fresh(...assets: Asset[]): void {
  state().enterProject({ ...emptyProject(), name: 'Sound', assets })
}

test('placing a video with sound makes a linked picture and sound on A1, as one undo step', () => {
  useEditingPrefs.getState().setSeparateClipAudio(true)
  fresh(asset('talk'))
  const past = state().past.length
  const picture = state().placeAsset('talk', 0)!
  const [v1] = tracks().filter((t) => t.kind === 'video')
  const [a1] = tracks().filter((t) => t.kind === 'audio')
  const placed = v1!.items.find((i) => i.id === picture)!
  const sound = a1!.items.find((i) => i.assetId === 'talk')
  assert.ok(sound, 'the sound is its own clip on A1')
  assert.equal(placed.audioDetached, true, 'the picture plays none of its own')
  assert.ok(placed.linkId && placed.linkId === sound.linkId, 'linked, so they move and trim together')
  assert.deepEqual([sound.from, sound.durationInFrames, sound.sourceStartUs], [placed.from, placed.durationInFrames, placed.sourceStartUs])
  assert.equal(state().past.length, past + 1, 'one undo step')
  state().undo()
  assert.equal(tracks().flatMap((t) => t.items).length, 0, 'one ⌘Z takes both back')
})

test('with the preference off the sound stays inside the picture; a silent video or a sound file is unchanged', () => {
  useEditingPrefs.getState().setSeparateClipAudio(false)
  try {
    fresh(asset('talk'))
    state().placeAsset('talk', 0)
    assert.equal(tracks().find((t) => t.kind === 'audio')!.items.length, 0, 'off: nothing on A1')
    assert.equal(tracks().find((t) => t.kind === 'video')!.items[0]!.audioDetached, undefined)
  } finally {
    useEditingPrefs.getState().setSeparateClipAudio(true)
  }
  fresh(asset('mute', { hasAudio: false }), asset('song', { kind: 'audio', hasVideo: false, width: null, height: null }))
  state().placeAsset('mute', 0)
  state().placeAsset('song', 0)
  const audio = tracks().filter((t) => t.kind === 'audio').flatMap((t) => t.items)
  assert.deepEqual(audio.map((i) => i.assetId), ['song'], 'a silent video brings no sound; a sound file is placed as itself')
  assert.equal(audio[0]!.linkId, undefined)
})

test('Replace takes the whole linked pair out and puts the new clip and its sound in their place', () => {
  useEditingPrefs.getState().setSeparateClipAudio(true)
  fresh(asset('old'), asset('new', { durationUs: 5_000_000 }))
  const old = state().placeAsset('old', 0)!
  state().select([old])
  state().setPlayhead(10)
  useSourceClip.getState().setSourceClip({ assetId: 'new' })
  const past = state().past.length
  const placed = runSourceEdit('replace')
  assert.ok(placed, state().toast?.text ?? 'refused')
  const all = tracks().flatMap((t) => t.items)
  assert.deepEqual(all.map((i) => i.assetId).sort(), ['new', 'new'], 'the old picture and its sound are gone; the new pair is in')
  const [picture, sound] = [all.find((i) => i.id === placed)!, all.find((i) => i.id !== placed)!]
  assert.equal(picture.linkId, sound.linkId)
  assert.deepEqual([picture.from, picture.durationInFrames], [0, 60], 'in the old clip’s place and length')
  assert.equal(state().past.length, past + 1, 'one undo step')
})
