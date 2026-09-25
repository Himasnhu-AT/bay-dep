import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { assetActions } from './assetActions'

function asset(patch: Partial<Asset> = {}): Asset {
  return {
    id: 'ast', kind: 'video', name: 'shot.mp4', path: '/m/shot.mp4', durationUs: 10_000_000,
    width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null,
    waveformPath: null, createdAt: 0, ...patch
  } as Asset
}

const ids = (list: ReturnType<typeof assetActions>): string[] => list.map((a) => a.id)
const byId = (list: ReturnType<typeof assetActions>, id: string) => list.find((a) => a.id === id)

test('a placed video with sound offers every action, all enabled', () => {
  const list = assetActions(asset(), { missing: false, uses: 1, busy: false })
  assert.deepEqual(ids(list), ['place', 'append', 'transcribe', 'beats', 'subtitles', 'reveal', 'rename', 'relink', 'remove'])
  assert.equal(list.filter((a) => a.disabled).length, 0)
})

test('transcript and subtitles wait for the clip to be placed, and say so', () => {
  const list = assetActions(asset(), { missing: false, uses: 0, busy: false })
  for (const id of ['transcribe', 'subtitles']) {
    const action = byId(list, id)!
    assert.equal(action.disabled, true, id)
    assert.match(action.hint ?? '', /Place it on the timeline first/)
    assert.match(action.menuLabel, /place it first/)
  }
  // Beats read the file, not the timeline: an unplaced clip can still be analysed.
  assert.equal(byId(list, 'beats')!.disabled, false)
})

test('a missing file cannot be placed or revealed, but can be located', () => {
  const list = assetActions(asset(), { missing: true, uses: 2, busy: false })
  assert.equal(byId(list, 'place')!.disabled, true)
  assert.equal(byId(list, 'reveal')!.disabled, true)
  const relink = byId(list, 'relink')!
  assert.equal(relink.disabled, false)
  assert.equal(relink.menuLabel, 'Locate Missing File…')
})

test('a title has no file, no sound and no placement refusal; a font is never placed', () => {
  const title = assetActions(asset({ kind: 'text', path: null, hasAudio: false, hasVideo: false, text: 'Hi' }), {
    missing: false, uses: 0, busy: false
  })
  assert.deepEqual(ids(title), ['place', 'append', 'rename', 'remove'])
  const font = assetActions(asset({ kind: 'font', hasAudio: false, hasVideo: false }), { missing: false, uses: 0, busy: false })
  assert.equal(byId(font, 'place'), undefined)
})

test('a running beat detection disables only itself', () => {
  const list = assetActions(asset(), { missing: false, uses: 1, busy: true })
  assert.deepEqual(list.filter((a) => a.disabled).map((a) => a.id), ['beats'])
})
