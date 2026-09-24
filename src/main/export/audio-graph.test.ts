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
import { effectiveSpeed, sourceTimeAt } from '@shared/project'
import type { CompositionSound } from '@shared/composition'
import { itemAudioGainAt } from '@shared/audio-gain'
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

test('a disabled clip is not heard in the file, and the enabled one beside it still is', () => {
  // `disabled` (⇧E) is read through `playableTimeline`, the same view the preview's audio engine
  // and the compositor take, so a switched-off clip cannot be silent on screen and loud in a file.
  const off = { ...item({ id: 'i1', assetId: 'a1', trackId: 't1', from: 0, durationInFrames: 90 }), disabled: true }
  const on = item({ id: 'i2', assetId: 'a2', trackId: 't1', from: 90, durationInFrames: 90 })
  const { project, timeline } = projectWith(
    [track('t1', 'audio', [off, on])],
    [asset('a1', '/off.wav'), asset('a2', '/on.wav')]
  )
  assert.deepEqual(buildAudioGraph(project, timeline, 0, 180)?.inputs, ['/on.wav'])
  // Positive control: enabled again, it is heard.
  delete (off as { disabled?: boolean }).disabled
  assert.deepEqual(buildAudioGraph(project, timeline, 0, 180)?.inputs, ['/off.wav', '/on.wav'])
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

/** The chain for one input, so a test reads its gain and nobody else's. */
function chainFor(filter: string, input: number): string {
  return filter.split(';').find((chain) => chain.startsWith(`[${input}:a]`)) ?? ''
}

test("a clip's exported gain is the shared gain, frame for frame, in full and partial exports", () => {
  // The requirement the old afade assertions stood in for: the level heard at a moment of the
  // file is the level the preview plays at that moment — and exporting only the back half of a
  // faded clip changes nothing about that moment. Checked by evaluating the filter, not by
  // reading which ffmpeg filter names it happens to contain.
  const { project, timeline } = single({
    from: 0,
    durationInFrames: 90,
    volume: 0.5,
    fadeInFrames: 15,
    fadeOutFrames: 15
  })
  const clip = timeline.tracks[0]!.items[0]!
  for (const [fromFrame, toFrame] of [[0, 90], [45, 90], [10, 80]] as const) {
    const filter = buildAudioGraph(project, timeline, fromFrame, toFrame)?.filter ?? ''
    for (let frame = fromFrame; frame < toFrame; frame += 1) {
      const expected = itemAudioGainAt(project, timeline, clip, frame)
      const actual = evaluate(chainFor(filter, 0), (frame - fromFrame) / 30)
      assert.ok(
        Math.abs(actual - expected) < 1e-5,
        `export ${fromFrame}-${toFrame}, frame ${frame}: ${actual} vs ${expected}`
      )
    }
  }
})

test('clips either side of a dissolve are heard across its window, on the shared curve', () => {
  // The fault this replaced: export mixed each clip over its own span with `afade`, so a
  // dissolve was a hard cut in the file while the preview cross-faded it.
  const out = item({ id: 'o', assetId: 'a1', trackId: 't1', from: 0, durationInFrames: 90 })
  const into = item({
    id: 'n',
    assetId: 'a1',
    trackId: 't1',
    from: 90,
    durationInFrames: 60,
    sourceStartUs: 2_000_000
  })
  const { project, timeline } = projectWith([track('t1', 'video', [out, into])], [asset('a1', '/a.mp4')])
  timeline.transitions = [
    { id: 'x', kind: 'cross-dissolve', fromItemId: 'o', toItemId: 'n', durationInFrames: 20 }
  ]
  const filter = buildAudioGraph(project, timeline, 0, 150)?.filter ?? ''
  const outgoing = chainFor(filter, 0)
  const incoming = chainFor(filter, 1)

  // Outgoing is heard to frame 100, ten frames past its end; incoming from frame 80, reading
  // the ten frames of handle before its own source start.
  assert.match(outgoing, /atrim=start=0\.000000:duration=3\.333333/, outgoing)
  assert.match(incoming, /atrim=start=1\.666667:duration=2\.333333/, incoming)
  assert.match(incoming, /adelay=2667:all=1/, incoming)

  for (let frame = 78; frame <= 102; frame += 1) {
    const t = frame / 30
    const heardOut = frame < 100 ? evaluate(outgoing, t) : 0
    const heardIn = frame >= 80 ? evaluate(incoming, t) : 0
    assert.ok(Math.abs(heardOut - itemAudioGainAt(project, timeline, out, frame)) < 1e-5, `out @${frame}`)
    assert.ok(Math.abs(heardIn - itemAudioGainAt(project, timeline, into, frame)) < 1e-5, `in @${frame}`)
  }
  // And it is a cross-fade, not two full-level signals overlapping.
  assert.ok(evaluate(outgoing, 90 / 30) < 1 && evaluate(incoming, 90 / 30) < 1, 'mid-window is a ramp on both sides')
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

test('the graph is padded with silence, so `-t` sets the length rather than the sources', () => {
  // The bug this pins: both callers cut the graph with `-t framesTotal/fps`, and `-t` is a
  // maximum. When the last clip's audio ran out a fraction before the last video frame — which
  // happens whenever a source's audio stream is slightly shorter than its container — the WAV
  // came out short, the mux's `-shortest` trimmed the *video* to match, and a 1438-frame export
  // produced a 1437-frame file. Exactly one frame, always the last, so it read as a rounding
  // curiosity rather than as audio deciding how long the picture is.
  const { project, timeline } = single()
  const graph = buildAudioGraph(project, timeline, 0, 90)

  assert.match(graph?.filter ?? '', /apad\[aout\]$/, 'the last stage before the output must pad')
  assert.equal(graph?.outputLabel, 'aout')
})

test('padding is the last stage, after the mix, not per input', () => {
  // Padding an input before `amix` would pad every source to infinity and `duration=longest`
  // would then never end. It has to come after.
  const a = item({ id: 'i1', assetId: 'a1', trackId: 't1', from: 0, durationInFrames: 90 })
  const b = item({ id: 'i2', assetId: 'a2', trackId: 't1', from: 30, durationInFrames: 90 })
  const { project, timeline } = projectWith(
    [track('t1', 'audio', [a, b])],
    [asset('a1', '/a.wav'), asset('a2', '/b.wav')]
  )
  const filter = buildAudioGraph(project, timeline, 0, 200)?.filter ?? ''
  assert.equal((filter.match(/apad/g) ?? []).length, 1, 'exactly one pad, on the mixed result')
  assert.ok(filter.indexOf('amix') < filter.indexOf('apad'), 'the pad must follow the mix')
})

// ---------------------------------------------------------------------------
// Sounds an HTML composition declares
// ---------------------------------------------------------------------------

function declared(over: Partial<CompositionSound> = {}): CompositionSound {
  return {
    id: 'whoosh',
    src: 'whoosh.wav',
    path: '/c/whoosh.wav',
    startSeconds: 0,
    durationSeconds: null,
    mediaStartSeconds: 0,
    volume: 1,
    line: 1,
    ...over
  }
}

const composition = (): Asset =>
  asset('comp', '/c/title.html', { kind: 'html', hasAudio: false, durationUs: 5_000_000 })

/** One composition clip on one track, declaring `sounds`. */
function sounding(spec: Partial<ItemSpec> = {}, sounds = [declared()], muted = false) {
  const one = item({ id: 'c1', assetId: 'comp', trackId: 't1', from: 0, durationInFrames: 150, ...spec })
  const { project, timeline } = projectWith([track('t1', 'video', [one], muted)], [composition()])
  return { project, timeline, item: one, map: new Map([['comp', sounds]]) }
}

/**
 * Evaluates a `volume` expression the way ffmpeg does, by giving `if` and `lt` their meaning.
 * The test reads the gain the export will apply rather than the text that encodes it, so a
 * rewrite of the expression's shape cannot pass by matching a pattern.
 */
function evaluate(filter: string, t: number): number {
  const constant = /volume=([0-9.]+)(?:[,;[]|$)/.exec(filter)
  if (constant) return Number(constant[1])
  const expression = /volume='([^']*)':eval=frame/.exec(filter)?.[1]
  // A chain at unity gain carries no volume stage at all; every test comparing against a ramp
  // expects something other than 1, so reading this as 1 cannot hide a missing ramp.
  if (!expression) return 1
  const run = new Function('t', 'iff', 'lt', `return ${expression.replace(/\bif\(/g, 'iff(')}`)
  return run(t, (c: number, a: number, b: number) => (c ? a : b), (a: number, b: number) => (a < b ? 1 : 0))
}

test('without its declarations a composition contributes nothing, as before', () => {
  const { project, timeline } = sounding()
  assert.equal(buildAudioGraph(project, timeline, 0, 150), null)
})

test('a declared sound is an input, delayed to where the clip shows its data-start', () => {
  const { project, timeline, map } = sounding({ from: 30 }, [declared({ startSeconds: 0.5 })])
  const graph = buildAudioGraph(project, timeline, 0, 300, map)
  assert.deepEqual(graph?.inputs, ['/c/whoosh.wav'])
  // Frame 30 is 1s; the clip shows composition 0.5s at 1.5s.
  assert.match(graph?.filter ?? '', /adelay=1500:all=1/)
})

test('a muted track silences its composition too, and an unmuted one does not', () => {
  const muted = sounding({}, [declared()], true)
  assert.equal(buildAudioGraph(muted.project, muted.timeline, 0, 150, muted.map), null)
  const open = sounding()
  assert.equal(buildAudioGraph(open.project, open.timeline, 0, 150, open.map)?.inputs.length, 1)
})

test('an export starting mid-sound enters the file at the matching point', () => {
  const { project, timeline, map } = sounding({}, [declared({ startSeconds: 1, mediaStartSeconds: 0.25 })])
  // Exporting from frame 60 (2s): one second into the sound, plus its own media offset.
  const filter = buildAudioGraph(project, timeline, 60, 150, map)?.filter ?? ''
  assert.match(filter, /atrim=start=1\.250000:duration=3\.000000/, filter)
  assert.doesNotMatch(filter, /adelay/)
})

test('the export gain is the shared gain, frame for frame — fades, volume and data-volume', () => {
  const spec = { volume: 0.5, fadeInFrames: 15, fadeOutFrames: 30 }
  const { project, timeline, item: clip, map } = sounding(spec, [declared({ volume: 0.8 })])
  const filter = buildAudioGraph(project, timeline, 0, 150, map)?.filter ?? ''
  for (const frame of [0, 3, 7, 14, 15, 60, 119, 120, 121, 135, 149]) {
    const expected = itemAudioGainAt(project, timeline, clip, frame) * 0.8
    const actual = evaluate(filter, frame / 30)
    assert.ok(Math.abs(actual - expected) < 1e-5, `frame ${frame}: ${actual} vs ${expected}`)
  }
})

test('a composition leaving through a dissolve is heard past its end, on the shared curve', () => {
  // The composition hands off to a plain clip at frame 90 with a 20-frame dissolve. Export's
  // clips predate the shared curve; the composition's sound must follow it anyway.
  const comp = item({ id: 'c1', assetId: 'comp', trackId: 't1', from: 0, durationInFrames: 90 })
  const next = item({ id: 'n1', assetId: 'a1', trackId: 't1', from: 90, durationInFrames: 60, sourceStartUs: 2_000_000 })
  const { project, timeline } = projectWith([track('t1', 'video', [comp, next])], [composition(), asset('a1', '/a.mp4')])
  timeline.transitions = [
    { id: 'x', kind: 'cross-dissolve', fromItemId: 'c1', toItemId: 'n1', durationInFrames: 20 }
  ]
  const map = new Map([['comp', [declared()]]])
  const graph = buildAudioGraph(project, timeline, 0, 150, map)
  const soundInput = graph?.inputs.indexOf('/c/whoosh.wav') ?? -1
  assert.notEqual(soundInput, -1)
  const chain = graph?.filter.split(';').find((c) => c.startsWith(`[${soundInput}:a]`)) ?? ''
  // Heard until the window closes at frame 100, not cut at the cut.
  assert.match(chain, /atrim=start=0\.000000:duration=3\.333333/, chain)
  for (const frame of [85, 90, 95, 99]) {
    const expected = itemAudioGainAt(project, timeline, comp, frame)
    assert.ok(Math.abs(evaluate(chain, frame / 30) - expected) < 1e-5, `frame ${frame}`)
  }
  assert.ok(evaluate(chain, 95 / 30) > 0 && evaluate(chain, 95 / 30) < 1, 'mid-dissolve is a ramp')
})

test('a steady sound gets a plain volume, not an expression', () => {
  const { project, timeline, map } = sounding({}, [declared({ volume: 0.8 })])
  const filter = buildAudioGraph(project, timeline, 0, 150, map)?.filter ?? ''
  assert.match(filter, /volume=0\.800000/)
  assert.doesNotMatch(filter, /eval=frame/)
})

test('clips and declared sounds share one mix, with every input index accounted for', () => {
  const clip = item({ id: 'i1', assetId: 'a1', trackId: 't2', from: 0, durationInFrames: 90 })
  const comp = item({ id: 'c1', assetId: 'comp', trackId: 't1', from: 0, durationInFrames: 150 })
  const { project, timeline } = projectWith(
    [track('t1', 'video', [comp]), track('t2', 'audio', [clip])],
    [composition(), asset('a1', '/a.wav')]
  )
  const map = new Map([['comp', [declared(), declared({ id: 'b', path: '/c/b.wav', startSeconds: 2 })]]])
  const graph = buildAudioGraph(project, timeline, 0, 150, map)
  assert.deepEqual(graph?.inputs, ['/a.wav', '/c/whoosh.wav', '/c/b.wav'])
  const referenced = [...(graph?.filter.matchAll(/\[(\d+):a\]/g) ?? [])].map((m) => Number(m[1]))
  assert.deepEqual(referenced, [0, 1, 2])
  assert.match(graph?.filter ?? '', /amix=inputs=3:normalize=0/)
})

test('export reads the same source time the preview seeks to, sped up and part-way in', () => {
  // The preview seeks with `sourceTimeAt`; export used to redo the arithmetic by hand, which is
  // how preview and export once disagreed about transition gain. A partial export of a 2× clip
  // with a source offset is where a second copy of the mapping would drift first.
  const { project, timeline } = single({ from: 10, durationInFrames: 90, sourceStartUs: 3_250_000, speed: 2 })
  const graph = buildAudioGraph(project, timeline, 40, 90)
  const start = /atrim=start=([0-9.]+)/.exec(chainFor(graph?.filter ?? '', 0))?.[1]
  const expected = sourceTimeAt(timeline.tracks[0]!.items[0]!, 40, timeline.fps) / 1_000_000
  assert.ok(expected > 3.25, 'specimen: part-way in, so the offset and the speed both count')
  assert.equal(Number(start), expected)
})

test('an unplayable speed plays at 1× in both, never NaN', () => {
  for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(effectiveSpeed(speed), 1, String(speed))
    const { project, timeline } = single({ from: 0, durationInFrames: 90, sourceStartUs: 1_000_000, speed })
    const clip = timeline.tracks[0]!.items[0]!
    assert.equal(sourceTimeAt(clip, 30, timeline.fps), 2_000_000, `preview at speed ${speed}`)
    assert.match(buildAudioGraph(project, timeline, 30, 90)?.filter ?? '', /atrim=start=2(\.0+)?:/, `export at speed ${speed}`)
  }
  assert.equal(effectiveSpeed(1.5), 1.5, 'positive control: a real speed passes through')
})
