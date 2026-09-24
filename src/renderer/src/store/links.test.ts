/**
 * Linked clips through the store: a picture and its detached sound move, trim, slip, split and
 * delete together — each paired with the same edit made `linked: false`, which must move one.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor, emptyProject } from './editor'
import { activeTimeline, type Asset, type Item, type Project } from '@shared/project'
import { linkedPartners } from '@shared/links'

function shot(): Asset {
  return {
    id: 'shot',
    kind: 'video',
    name: 'shot.mp4',
    path: '/m/shot.mp4',
    durationUs: 60_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

function load(): { pictureId: string; audioId: string } {
  const project: Project = emptyProject()
  project.assets.push(shot())
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const item: Item = {
    id: 'pic',
    assetId: 'shot',
    trackId: video.id,
    from: 30,
    durationInFrames: 90,
    sourceStartUs: 2_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
  video.items.push(item)
  useEditor.getState().setProject(project, { resetHistory: true })
  const result = useEditor.getState().detachAudio(['pic'])
  assert.equal(result.detached.length, 1, JSON.stringify(result.refused))
  return { pictureId: 'pic', audioId: result.detached[0]!.audioId }
}

const item = (id: string): Item | undefined =>
  activeTimeline(useEditor.getState().project)!.tracks.flatMap((t) => t.items).find((i) => i.id === id)

test('detach is one undo step, and undo puts the sound back on the picture', () => {
  const { audioId } = load()
  assert.equal(useEditor.getState().past.length, 1)
  assert.equal(item('pic')?.audioDetached, true)
  useEditor.getState().undo()
  assert.equal(item(audioId), undefined)
  assert.equal(item('pic')?.audioDetached, undefined)
})

test('moving either side moves both; linked: false moves one', () => {
  const { audioId } = load()
  useEditor.getState().moveItem(audioId, 50)
  assert.equal(item(audioId)?.from, 50)
  assert.equal(item('pic')?.from, 50, 'the picture followed its sound')
  useEditor.getState().moveItem('pic', 60, undefined, { linked: false })
  assert.equal(item('pic')?.from, 60)
  assert.equal(item(audioId)?.from, 50, 'the sound stayed')
})

test('a linked move that the partner cannot make is refused whole, not half-done', () => {
  const { audioId } = load()
  // The sound cannot go before frame 0; moving the picture 40 frames left would put it at -10.
  useEditor.getState().moveItem(audioId, 25, undefined, { linked: false })
  const before = useEditor.getState().past.length
  useEditor.getState().moveItem('pic', 0)
  assert.equal(item('pic')?.from, 30, 'the picture did not move alone')
  assert.equal(item(audioId)?.from, 25)
  assert.equal(useEditor.getState().past.length, before, 'and no empty undo step')
})

test('trimming the head of one trims both and keeps the in-points equal', () => {
  const { audioId } = load()
  useEditor.getState().trimItem('pic', 'start', 45)
  for (const id of ['pic', audioId]) {
    assert.equal(item(id)?.from, 45, id)
    assert.equal(item(id)?.durationInFrames, 75, id)
    assert.equal(item(id)?.sourceStartUs, 2_500_000, id)
  }
  useEditor.getState().trimItem(audioId, 'end', 100, { linked: false })
  assert.equal(item(audioId)?.durationInFrames, 55)
  assert.equal(item('pic')?.durationInFrames, 75)
})

test('a slip of the picture slips its sound', () => {
  const { audioId } = load()
  const result = useEditor.getState().trimEdit({ itemId: 'pic', mode: 'slip', deltaFrames: 15 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(item('pic')?.sourceStartUs, item(audioId)?.sourceStartUs)
  assert.equal(item(audioId)?.sourceStartUs, 2_500_000)
  assert.deepEqual(result.changes.map((c) => c.itemId).sort(), ['pic', audioId].sort())
})

test('patching a sync field carries the change; level and fades stay each clip\'s own', () => {
  const { audioId } = load()
  useEditor.getState().patchItem('pic', { from: 40, fadeOutFrames: 12 })
  assert.equal(item(audioId)?.from, 40)
  assert.equal(item(audioId)?.fadeOutFrames, 0, 'the picture fade is not the sound\'s')
  useEditor.getState().patchItem(audioId, { volume: 0.5 })
  assert.equal(item('pic')?.volume, 1)
})

test('splitting a selected picture splits its sound, into two linked pairs', () => {
  const { audioId } = load()
  useEditor.getState().select(['pic'])
  useEditor.getState().splitAt(60)
  const tl = activeTimeline(useEditor.getState().project)!
  const all = tl.tracks.flatMap((t) => t.items)
  assert.equal(all.length, 4)
  const tails = all.filter((i) => i.from === 60)
  assert.equal(tails.length, 2, 'both were cut')
  assert.deepEqual(linkedPartners(tl, 'pic').map((i) => i.id), [audioId])
  assert.equal(linkedPartners(tl, tails[0]!.id)[0]?.id, tails[1]!.id, 'the tails are linked to each other')
  assert.notEqual(tails[0]!.linkId, item('pic')!.linkId)
})

test('deleting one deletes both; after unlinking, deleting one leaves the other', () => {
  const { audioId } = load()
  useEditor.getState().select([audioId])
  useEditor.getState().deleteSelected()
  assert.equal(item('pic'), undefined)
  assert.equal(item(audioId), undefined)

  const again = load()
  useEditor.getState().unlinkItems([again.pictureId])
  useEditor.getState().select([again.audioId])
  useEditor.getState().deleteSelected()
  assert.ok(item('pic'), 'the picture stays')
  assert.equal(item(again.audioId), undefined)
})
