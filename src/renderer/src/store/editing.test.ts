/**
 * The keyboard editing verbs through the store (`slices/editing.ts`): Remove In to Out against the
 * `remove_range` tool, ripple and plain trim to playhead, the clip clipboard as one undo step,
 * enable/disable, nudge refusals, and the In/Out rules.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeTimeline, playableTimeline, type Asset, type Item, type Project, type Timeline } from '@shared/project'
import { removeRange } from '@/mcp/write'
import { emptyProject, useEditor } from './editor'

function shot(id: string): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/m/${id}.mp4`,
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

function clip(id: string, trackId: string, from: number, duration: number, over: Partial<Item> = {}): Item {
  return {
    id,
    assetId: id,
    trackId,
    from,
    durationInFrames: duration,
    sourceStartUs: 5_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...over
  }
}

/** V1: A 0–30, gap 30–60, B 60–120, C 120–150. A1: M 0–150. */
function load(): void {
  const project: Project = emptyProject()
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const audio = timeline.tracks.find((t) => t.kind === 'audio')!
  for (const id of ['A', 'B', 'C', 'M']) project.assets.push(shot(id))
  video.items.push(clip('A', video.id, 0, 30), clip('B', video.id, 60, 60), clip('C', video.id, 120, 30))
  audio.items.push(clip('M', audio.id, 0, 150))
  const store = useEditor.getState()
  store.setProject(project, { resetHistory: true })
  useEditor.setState({ selection: [], playhead: 0, rangeIn: null, rangeOut: null, clipboard: null, toast: null, screen: 'editor' })
}

const tl = (): Timeline => activeTimeline(useEditor.getState().project)!
const item = (id: string): Item | undefined => tl().tracks.flatMap((t) => t.items).find((i) => i.id === id)
/** The timeline as positions only — ids of split halves are random, so they are left out. */
const shape = (timeline: Timeline): string[] =>
  timeline.tracks.flatMap((t) =>
    [...t.items].sort((a, b) => a.from - b.from).map((i) => `${t.kind}:${i.assetId}@${i.from}+${i.durationInFrames}/${i.sourceStartUs}`)
  )

test('Remove In to Out leaves exactly the timeline the remove_range tool leaves', () => {
  load()
  useEditor.getState().setRangeIn(20)
  useEditor.getState().setRangeOut(70)
  useEditor.getState().removeInOutRange()
  const byHand = shape(tl())
  assert.equal(useEditor.getState().rangeIn, null, 'the range is spent')
  useEditor.getState().undo()
  const restored = shape(tl())
  removeRange({ fromFrame: 20, toFrame: 70 })
  assert.deepEqual(byHand, shape(tl()))
  // And it did something: 50 frames (Out exclusive) came out of the 150-frame music bed.
  assert.notDeepEqual(byHand, restored)
  assert.ok(byHand.includes('audio:M@0+20/5000000'), byHand.join(' '))
  assert.ok(byHand.some((s) => s.startsWith('audio:M@20+80/')), byHand.join(' '))
})

test('Remove In to Out with no range asks for one, and changes nothing', () => {
  load()
  const before = useEditor.getState().project
  useEditor.getState().removeInOutRange()
  assert.equal(useEditor.getState().project, before)
  assert.match(useEditor.getState().toast?.text ?? '', /I sets In, O sets Out/)
})

test('In and Out keep In before Out: setting one across the other clears the other', () => {
  load()
  const store = useEditor.getState()
  store.setRangeIn(50)
  store.setRangeOut(80)
  store.setRangeIn(90)
  assert.deepEqual([useEditor.getState().rangeIn, useEditor.getState().rangeOut], [90, null])
  store.setRangeOut(40)
  assert.deepEqual([useEditor.getState().rangeIn, useEditor.getState().rangeOut], [null, 40])
})

test('ripple trim start (Q) closes only what it cut off, never a gap that was already there', () => {
  load()
  useEditor.setState({ playhead: 80, selection: ['B'] })
  useEditor.getState().trimToPlayhead('start', true)
  assert.equal(item('B')?.from, 60, 'B keeps its place after the 30–60 gap')
  assert.equal(item('B')?.durationInFrames, 40)
  assert.equal(item('C')?.from, 100, 'C closes up by the 20 frames cut')
  assert.equal(useEditor.getState().playhead, 60, 'the playhead follows the frame it was on')
  assert.equal(useEditor.getState().past.length, 1, 'one undo step')
})

test('plain trim start (⌥Q) leaves the gap; ripple trim end (W) pulls the next clip in', () => {
  load()
  useEditor.setState({ playhead: 80, selection: ['B'] })
  useEditor.getState().trimToPlayhead('start', false)
  assert.equal(item('B')?.from, 80)
  assert.equal(item('C')?.from, 120, 'nothing else moved')
  load()
  useEditor.setState({ playhead: 100, selection: ['B'] })
  useEditor.getState().trimToPlayhead('end', true)
  assert.equal(item('B')?.durationInFrames, 40)
  assert.equal(item('C')?.from, 100)
})

test('copy and paste put the clips at the playhead as one undo step, and select them', () => {
  load()
  useEditor.setState({ selection: ['A'] })
  assert.equal(useEditor.getState().copySelection(), 1)
  useEditor.setState({ playhead: 200 })
  const ids = useEditor.getState().paste()
  assert.equal(ids.length, 1)
  assert.equal(item(ids[0]!)?.from, 200)
  assert.deepEqual(useEditor.getState().selection, ids)
  assert.equal(useEditor.getState().past.length, 1)
  useEditor.getState().undo()
  assert.equal(item(ids[0]!), undefined)
})

test('cut removes what it copied; paste with an empty clipboard says what to do', () => {
  load()
  useEditor.getState().paste()
  assert.match(useEditor.getState().toast?.text ?? '', /Copy clips/)
  useEditor.setState({ selection: ['C'] })
  useEditor.getState().cutSelection()
  assert.equal(item('C'), undefined)
  assert.equal(useEditor.getState().clipboard?.items[0]?.id, 'C')
})

test('disabling a clip takes it out of the playable timeline; a second toggle puts it back', () => {
  load()
  useEditor.setState({ selection: ['B'] })
  useEditor.getState().toggleDisabled()
  assert.equal(item('B')?.disabled, true)
  const playable = playableTimeline(tl())
  assert.equal(playable.tracks.flatMap((t) => t.items).some((i) => i.id === 'B'), false)
  assert.equal(playable.tracks.flatMap((t) => t.items).some((i) => i.id === 'C'), true)
  useEditor.getState().toggleDisabled()
  assert.equal(item('B')?.disabled, undefined, 'enabled is stored as absence')
  assert.equal(playableTimeline(tl()), tl(), 'nothing disabled: the timeline itself')
})

test('a blocked nudge changes nothing and the toast names the clip in the way', () => {
  load()
  useEditor.setState({ selection: ['B'] })
  const before = useEditor.getState().project
  assert.equal(useEditor.getState().nudgeSelection(1), false)
  assert.equal(useEditor.getState().project, before)
  assert.match(useEditor.getState().toast?.text ?? '', /C\.mp4/)
  // Positive control: left into the gap is free.
  assert.equal(useEditor.getState().nudgeSelection(-10), true)
  assert.equal(item('B')?.from, 50)
})

test('close gap at a frame closes that track and reports the span', () => {
  load()
  const video = tl().tracks.find((t) => t.kind === 'video')!
  const result = useEditor.getState().closeGapAt(video.id, 45)
  assert.deepEqual(result, { closedFrames: 30, from: 30, to: 60 })
  assert.equal(item('B')?.from, 30)
  assert.equal(item('M')?.from, 0, 'the unlinked music on another track did not move')
})
