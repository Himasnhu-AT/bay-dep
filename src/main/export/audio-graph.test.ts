/**
 * Tests for the export audio mix.
 *
 * Every case here is a way the exported audio can differ from what the user monitored, while
 * the export itself reports success. There is no assertion you could make by listening to a
 * short clip: a fade in the wrong place, a track that should have been silent, an eighth of
 * the intended volume and a mix that lost every clip's audio because one file was unreadable
 * all produce a file that plays.
 *
 * The filter *order* is the substance of most of it. Fades belong after the item's own trim
 * and speed change but before the export range is clipped out of it — get that backwards and
 * a partial-range export has its envelope in the wrong place, which only shows when someone
 * exports a selection rather than the whole timeline.
 *
 * Proven against six deliberate regressions, all caught: fades moved after the sub-range trim,
 * the sub-range trim deleted, `normalize=0` flipped, the `asset.error` skip removed, the
 * `track.muted` guard removed, and the `hasAudio` requirement dropped. Each mutation asserted
 * that it had actually applied before the suite ran — the first pass of this exercise scored a
 * false "not caught" from a mutation whose indentation did not match, which would have sent
 * someone rewriting a test that was working.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/export/audio-graph.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Layout, Project, Timeline, Track, TrackKind } from '@shared/project'
import { buildAudioGraph } from './audio-graph'

const LAYOUT: Layout = { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 }

interface ItemSpec {
  id: string
  assetId: string
  trackId: string
  from: number
  durationInFrames: number
  sourceStartUs?: number
  volume?: number
  fadeInFrames?: number
  fadeOutFrames?: number
  speed?: number
}

function item(spec: ItemSpec): Item {
  return {
    id: spec.id,
    assetId: spec.assetId,
    trackId: spec.trackId,
    from: spec.from,
    durationInFrames: spec.durationInFrames,
    sourceStartUs: spec.sourceStartUs ?? 0,
    layout: LAYOUT,
    volume: spec.volume ?? 1,
    fadeInFrames: spec.fadeInFrames ?? 0,
    fadeOutFrames: spec.fadeOutFrames ?? 0,
    speed: spec.speed ?? 1
  }
}

function asset(id: string, path: string | null, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'video',
    name: path ?? id,
    path,
    durationUs: 60_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0,
    ...overrides
  }
}

function track(id: string, kind: TrackKind, items: Item[], muted = false): Track {
  return { id, kind, name: id, locked: false, muted, hidden: false, items }
}

function projectWith(tracks: Track[], assets: Asset[]): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'Timeline 1',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000000',
    tracks
  }
  const project: Project = {
    id: 'prj',
    name: 'Test',
    version: 1,
    assets,
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

/** One audio item on one unmuted track, for the cases that only need a single chain. */
function single(spec: Partial<ItemSpec> = {}, assetOverrides: Partial<Asset> = {}) {
  const one = item({
    id: 'i1',
    assetId: 'a1',
    trackId: 't1',
    from: 0,
    durationInFrames: 90,
    ...spec
  })
  return projectWith([track('t1', 'audio', [one])], [asset('a1', '/a.wav', assetOverrides)])
}

// ---------------------------------------------------------------------------
// Which items contribute
// ---------------------------------------------------------------------------

test('a timeline with no audible audio yields no graph at all', () => {
  const { project, timeline } = projectWith([track('t1', 'audio', [])], [])
  assert.equal(buildAudioGraph(project, timeline, 0, 90), null)
})

test('a muted track contributes nothing, whichever kind it is', () => {
  const one = item({ id: 'i1', assetId: 'a1', trackId: 't1', from: 0, durationInFrames: 90 })
  const { project, timeline } = projectWith(
    [track('t1', 'audio', [one], true)],
    [asset('a1', '/a.wav')]
  )
  assert.equal(buildAudioGraph(project, timeline, 0, 90), null)
})

test("a video track's own audio is mixed, because that is where dialogue lives", () => {
  // The renderer's audio engine walks every track rather than going through `itemsAtFrame`,
  // which filters by kind. Export has to agree or most real edits lose their dialogue.
  const one = item({ id: 'i1', assetId: 'a1', trackId: 't1', from: 0, durationInFrames: 90 })
  const { project, timeline } = projectWith(
    [track('t1', 'video', [one])],
    [asset('a1', '/clip.mp4')]
  )
  const graph = buildAudioGraph(project, timeline, 0, 90)
  assert.deepEqual(graph?.inputs, ['/clip.mp4'])
})

test('an asset whose probe failed is skipped rather than failing the whole mix', () => {
  // One unreadable file would make ffmpeg refuse the entire `amix`, costing every other clip
  // its audio and reporting it as a mix failure rather than a bad file. The preview engine
  // skips these in the same walk; export must agree.
  const good = item({ id: 'i1', assetId: 'ok', trackId: 't1', from: 0, durationInFrames: 90 })
  const bad = item({ id: 'i2', assetId: 'bad', trackId: 't1', from: 0, durationInFrames: 90 })
  const { project, timeline } = projectWith(
    [track('t1', 'audio', [good, bad])],
    [asset('ok', '/ok.wav'), asset('bad', '/bad.mov', { error: 'ffprobe found no streams' })]
  )
  const graph = buildAudioGraph(project, timeline, 0, 90)
  assert.deepEqual(graph?.inputs, ['/ok.wav'])
})

test('an asset with no audio, and one with no file, contribute nothing', () => {
  const silent = item({ id: 'i1', assetId: 'v', trackId: 't1', from: 0, durationInFrames: 90 })
  const text = item({ id: 'i2', assetId: 'txt', trackId: 't1', from: 0, durationInFrames: 90 })
  const { project, timeline } = projectWith(
    [track('t1', 'audio', [silent, text])],
    [
      asset('v', '/silent.mp4', { hasAudio: false }),
      asset('txt', null, { kind: 'text', hasAudio: true })
    ]
  )
  assert.equal(buildAudioGraph(project, timeline, 0, 90), null)
})

test('an item silenced to zero gain is dropped rather than decoded', () => {
  const { project, timeline } = single({ volume: 0 })
  assert.equal(buildAudioGraph(project, timeline, 0, 90), null)
})

test('an item entirely outside the export range contributes nothing', () => {
  const { project, timeline } = single({ from: 300, durationInFrames: 90 })
  assert.equal(buildAudioGraph(project, timeline, 0, 90), null)
})

// ---------------------------------------------------------------------------
// The chain, and the order of it
// ---------------------------------------------------------------------------

test('the source range comes from sourceStartUs and the item duration', () => {
  const { project, timeline } = single({ sourceStartUs: 2_000_000, durationInFrames: 90 })
  const graph = buildAudioGraph(project, timeline, 0, 90)
  // 90 frames at 30fps is 3s of timeline, read from 2s into the source.
  assert.match(graph?.filter ?? '', /atrim=start=2\.000000:duration=3\.000000/)
})

test('speed stretches the source range and chains atempo within its legal window', () => {
  // atempo accepts 0.5-2.0 only. 4x needs two stages; clamping instead would change pitch
  // without saying so.
  const { project, timeline } = single({ speed: 4, durationInFrames: 90 })
  const filter = buildAudioGraph(project, timeline, 0, 90)?.filter ?? ''
  assert.match(filter, /atrim=start=0\.000000:duration=12\.000000/)
  assert.equal((filter.match(/atempo=/g) ?? []).length, 2)
})

test('a slow item chains atempo the other way', () => {
  const { project, timeline } = single({ speed: 0.25, durationInFrames: 90 })
  const filter = buildAudioGraph(project, timeline, 0, 90)?.filter ?? ''
  assert.equal((filter.match(/atempo=/g) ?? []).length, 2)
  assert.match(filter, /atempo=0\.5/)
})

test('speed 1 adds no atempo at all', () => {
  const { project, timeline } = single({ speed: 1 })
  assert.doesNotMatch(buildAudioGraph(project, timeline, 0, 90)?.filter ?? '', /atempo/)
})

test('an item is delayed to its position on the timeline', () => {
  const { project, timeline } = single({ from: 60, durationInFrames: 30 })
  // Frame 60 at 30fps is 2000ms. `all=1` or the delay lands on the left channel only.
  assert.match(buildAudioGraph(project, timeline, 0, 90)?.filter ?? '', /adelay=2000:all=1/)
})

test('an item at the start of the range is not delayed', () => {
  const { project, timeline } = single({ from: 0 })
  assert.doesNotMatch(buildAudioGraph(project, timeline, 0, 90)?.filter ?? '', /adelay/)
})

test('fades are applied before the export range is trimmed out of the item', () => {
  // The order is the whole point. Exporting the back half of a faded clip must produce the
  // same envelope at that moment as exporting the whole thing; applying the fade after the
  // sub-range trim would restart it at the cut.
  const { project, timeline } = single({
    from: 0,
    durationInFrames: 90,
    fadeInFrames: 15,
    fadeOutFrames: 15
  })
  const filter = buildAudioGraph(project, timeline, 45, 90)?.filter ?? ''

  const fadeIn = filter.indexOf('afade=t=in')
  const fadeOut = filter.indexOf('afade=t=out')
  const rangeTrim = filter.indexOf('atrim=start=1.500000')

  assert.notEqual(fadeIn, -1, 'the fade-in survived into a partial export')
  assert.notEqual(rangeTrim, -1, 'the export sub-range was trimmed out of the item')
  assert.ok(fadeIn < rangeTrim, 'fade-in must precede the sub-range trim')
  assert.ok(fadeOut < rangeTrim, 'fade-out must precede the sub-range trim')
})

test('the fade-out is positioned from the end of the item, not the end of the range', () => {
  const { project, timeline } = single({ durationInFrames: 90, fadeOutFrames: 15 })
  // 90 frames is 3s; a 0.5s fade-out starts at 2.5s.
  assert.match(
    buildAudioGraph(project, timeline, 0, 90)?.filter ?? '',
    /afade=t=out:st=2\.500000:d=0\.500000/
  )
})

test('a fade longer than the item does not produce a negative start time', () => {
  const { project, timeline } = single({ durationInFrames: 30, fadeOutFrames: 90 })
  const filter = buildAudioGraph(project, timeline, 0, 30)?.filter ?? ''
  assert.doesNotMatch(filter, /st=-/)
})

test('an item fully inside the range gets no second trim', () => {
  const { project, timeline } = single({ from: 10, durationInFrames: 30 })
  const filter = buildAudioGraph(project, timeline, 0, 90)?.filter ?? ''
  assert.equal((filter.match(/atrim=/g) ?? []).length, 1)
})

// ---------------------------------------------------------------------------
// The mix
// ---------------------------------------------------------------------------

test('mixing does not divide by the number of inputs', () => {
  // amix normalises by default, so eight clips would export at an eighth of the volume the
  // user monitored — a change nobody would attribute to the mixer.
  const a = item({ id: 'i1', assetId: 'a1', trackId: 't1', from: 0, durationInFrames: 90 })
  const b = item({ id: 'i2', assetId: 'a2', trackId: 't2', from: 0, durationInFrames: 90 })
  const { project, timeline } = projectWith(
    [track('t1', 'audio', [a]), track('t2', 'audio', [b])],
    [asset('a1', '/a.wav'), asset('a2', '/b.wav')]
  )
  const graph = buildAudioGraph(project, timeline, 0, 90)
  assert.equal(graph?.inputs.length, 2)
  assert.match(graph?.filter ?? '', /amix=inputs=2:normalize=0/)
})

test('a single source still produces a mappable output label', () => {
  const { project, timeline } = single()
  const graph = buildAudioGraph(project, timeline, 0, 90)
  assert.equal(graph?.outputLabel, 'aout')
  assert.match(graph?.filter ?? '', /\[aout\]$/)
})

test('every input index in the filter has a matching -i', () => {
  // A label pointing at an input that was never added is an ffmpeg error at export time,
  // long after the graph looked plausible.
  const a = item({ id: 'i1', assetId: 'a1', trackId: 't1', from: 0, durationInFrames: 90 })
  const b = item({ id: 'i2', assetId: 'a2', trackId: 't1', from: 30, durationInFrames: 90 })
  const c = item({ id: 'i3', assetId: 'a1', trackId: 't2', from: 60, durationInFrames: 90 })
  const { project, timeline } = projectWith(
    [track('t1', 'audio', [a, b]), track('t2', 'audio', [c])],
    [asset('a1', '/a.wav'), asset('a2', '/b.wav')]
  )
  const graph = buildAudioGraph(project, timeline, 0, 200)
  const referenced = [...(graph?.filter.matchAll(/\[(\d+):a\]/g) ?? [])].map((m) => Number(m[1]))
  assert.deepEqual(referenced, [0, 1, 2])
  assert.equal(graph?.inputs.length, 3)
})

test('every chain is normalised to one format before the mix', () => {
  // amix will not mix streams of differing sample rates or layouts.
  const { project, timeline } = single()
  assert.match(buildAudioGraph(project, timeline, 0, 90)?.filter ?? '', /aformat=sample_fmts=/)
})
