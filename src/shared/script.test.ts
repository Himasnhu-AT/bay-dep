/**
 * The Script surface: render, parse, diff, apply.
 *
 * Assertions are written against the timeline an edit produces — where each clip sits, what
 * source it reads — rather than against the operations list, because the operations are
 * implementation and the resulting timeline is the requirement. Every refusal is paired with the
 * nearest edit that must still succeed, and refusals are checked for the line number and the
 * way out, not merely for existing.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyScriptOps,
  diffScript,
  parseScript,
  parseScriptTimecode,
  planScript,
  renderScript,
  scriptTimecode,
  type ScriptDiff
} from './script'
import {
  findItem,
  itemEnd,
  sourceTimeAt,
  type Asset,
  type Item,
  type Project,
  type Timeline,
  type Track
} from './project'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const clone = <T>(value: T): T => structuredClone(value)

function asset(id: string, partial: Partial<Asset>): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/media/${id}.mp4`,
    durationUs: 60_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0,
    ...partial
  }
}

function item(id: string, trackId: string, assetId: string, from: number, duration: number, extra: Partial<Item> = {}): Item {
  return {
    id,
    assetId,
    trackId,
    from,
    durationInFrames: duration,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...extra
  }
}

function track(id: string, name: string, kind: 'video' | 'audio', items: Item[], locked = false): Track {
  return { id, kind, name, locked, muted: false, hidden: false, items }
}

function project(timeline: Timeline, assets: Asset[]): Project {
  return {
    id: 'prj_1',
    name: 'Fixture',
    version: 1,
    assets,
    timelines: [timeline],
    activeTimelineId: timeline.id,
    createdAt: 0,
    updatedAt: 0,
    filePath: null
  }
}

/**
 * Three abutting interview clips on V1 with a dissolve on the first cut, titles with gaps on
 * V2 (two sharing one text asset), music on A1, and a locked V3. Ids share long prefixes the
 * way real ones do, so short ids have to be computed rather than truncated.
 */
function multiTrack(): Project {
  const tl: Timeline = {
    id: 'tl_main',
    name: 'Interview',
    fps: 30,
    width: 1920,
    height: 1080,
    background: '#000000',
    tracks: [
      track('trk_v1', 'V1', 'video', [
        item('itm_20240001aa', 'trk_v1', 'ast_goodall', 0, 90, { sourceStartUs: 10_000_000 }),
        item('itm_20240001ab', 'trk_v1', 'ast_broll', 90, 60, { sourceStartUs: 5_000_000 }),
        item('itm_20240001ac', 'trk_v1', 'ast_goodall', 150, 120, { sourceStartUs: 30_000_000 })
      ]),
      track('trk_v2', 'V2', 'video', [
        item('itm_20240002aa', 'trk_v2', 'ast_title', 15, 45),
        item('itm_20240002ab', 'trk_v2', 'ast_lower', 120, 60),
        item('itm_20240002ac', 'trk_v2', 'ast_lower', 200, 40)
      ]),
      track('trk_a1', 'A1', 'audio', [
        item('itm_20240003aa', 'trk_a1', 'ast_music', 0, 270, { sourceStartUs: 0 })
      ]),
      track('trk_v3', 'V3', 'video', [item('itm_20240004aa', 'trk_v3', 'ast_logo', 0, 60)], true)
    ],
    transitions: [
      {
        id: 'trn_1',
        kind: 'cross-dissolve',
        fromItemId: 'itm_20240001aa',
        toItemId: 'itm_20240001ab',
        durationInFrames: 20
      }
    ]
  }
  return project(tl, [
    asset('ast_goodall', { name: 'goodall.mp4' }),
    asset('ast_broll', { name: 'broll · wide.mov', durationUs: 20_000_000 }),
    asset('ast_music', { kind: 'audio', name: 'music.wav', hasVideo: false, width: null, height: null }),
    asset('ast_logo', { kind: 'image', name: 'logo.png', durationUs: 0, hasAudio: false }),
    asset('ast_title', { kind: 'text', name: 'Jane Goodall', path: null, durationUs: 0, text: 'Jane Goodall\nPrimatologist "the" · "one"' }),
    asset('ast_lower', { kind: 'text', name: 'Gombe, 1960', path: null, durationUs: 0, text: 'Gombe, 1960' })
  ])
}

/** Text only, at 29.97 with a clip at double speed and one past the hour mark. */
function oddRates(): Project {
  const tl: Timeline = {
    id: 'tl_ntsc',
    name: 'NTSC',
    fps: 30000 / 1001,
    width: 1280,
    height: 720,
    background: '#000000',
    tracks: [
      track('trk_a', 'V1', 'video', [
        item('itm_a', 'trk_a', 'ast_v', 0, 100, { speed: 2, sourceStartUs: 1_234_567 }),
        item('itm_b', 'trk_a', 'ast_v', 30 * 3600 + 7, 29)
      ]),
      track('trk_b', 'V2', 'video', [item('itm_c', 'trk_b', 'ast_t', 5, 10)])
    ]
  }
  return project(tl, [
    asset('ast_v', { durationUs: 7_200_000_000 }),
    asset('ast_t', { kind: 'text', name: 'Hi', path: null, durationUs: 0, text: 'Hi' })
  ])
}

function empty(): Project {
  return project(
    {
      id: 'tl_empty',
      name: 'Empty',
      fps: 25,
      width: 1920,
      height: 1080,
      background: '#000000',
      tracks: [track('trk_e1', 'V1', 'video', []), track('trk_e2', 'A1', 'audio', [])]
    },
    []
  )
}

const FIXTURES: [string, () => Project][] = [
  ['multi-track with text, gaps, a locked track and a transition', multiTrack],
  ['29.97 fps, speed 2, past an hour', oddRates],
  ['an empty timeline', empty]
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tlOf = (p: Project): Timeline => p.timelines[0]!

function edit(p: Project, change: (lines: string[]) => string[]): string {
  return change(renderScript(p, tlOf(p).id).split('\n')).join('\n')
}

/** Index of the line holding `needle`, asserted present so a fixture change cannot hollow a test. */
function at(lines: string[], needle: string): number {
  const index = lines.findIndex((l) => l.includes(needle))
  assert.ok(index >= 0, `no line contains ${needle}:\n${lines.join('\n')}`)
  return index
}

function replaceIn(lines: string[], needle: string, from: string, to: string): string[] {
  const i = at(lines, needle)
  assert.ok(lines[i]!.includes(from), `line ${i + 1} has no "${from}": ${lines[i]}`)
  const out = [...lines]
  out[i] = lines[i]!.replace(from, to)
  assert.notEqual(out[i], lines[i], 'the edit did not change the line')
  return out
}

function without(lines: string[], needle: string): string[] {
  const i = at(lines, needle)
  return lines.filter((_, index) => index !== i)
}

function plan(p: Project, text: string): ScriptDiff {
  const outcome = planScript(p, tlOf(p).id, text)
  assert.ok(!('error' in outcome), 'error' in outcome ? outcome.error : '')
  return outcome.diff
}

function refusal(p: Project, text: string): string {
  const outcome = planScript(p, tlOf(p).id, text)
  assert.ok('error' in outcome, 'expected a refusal, got operations')
  return outcome.error
}

let minted = 0
function applied(p: Project, text: string): Project {
  const next = clone(p)
  applyScriptOps(next, tlOf(next).id, plan(p, text).operations, (prefix) => `${prefix}_new${++minted}`)
  return next
}

const at_ = (p: Project, id: string): Item => {
  const found = findItem(tlOf(p), id)
  assert.ok(found, `item ${id} is gone`)
  return found.item
}

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

for (const [name, make] of FIXTURES) {
  test(`an unchanged script is zero operations: ${name}`, () => {
    const p = make()
    const text = renderScript(p, tlOf(p).id)
    const parsed = parseScript(text)
    assert.ok(!('error' in parsed), 'error' in parsed ? parsed.error : '')
    const diff = diffScript(p, tlOf(p).id, parsed)
    assert.ok(!('error' in diff), 'error' in diff ? diff.error : '')
    assert.deepEqual(diff.operations, [])
    assert.deepEqual(diff.notes, [])
  })

  test(`rendering is deterministic and applying nothing changes nothing: ${name}`, () => {
    const p = make()
    const text = renderScript(p, tlOf(p).id)
    assert.equal(renderScript(clone(p), tlOf(p).id), text)
    assert.deepEqual(applied(p, text), p)
  })
}

test('the round trip is not vacuous: one changed character is one operation', () => {
  // The positive control for the loop above. A diff that returned [] for everything would pass
  // every round trip.
  const p = multiTrack()
  const text = edit(p, (l) => replaceIn(l, '"Gombe, 1960"', 'Gombe, 1960', 'Gombe, 1961'))
  const ops = plan(p, text).operations
  assert.equal(ops.length, 1)
  assert.equal(ops[0]!.op, 'setText')
})

test('timecodes are exact both ways at the nominal rate, including 29.97 and past an hour', () => {
  for (const fps of [24, 25, 30, 30000 / 1001, 60]) {
    for (const frame of [0, 1, 29, 30, 59, 1799, 1800, 108_000, 108_007, 250_001]) {
      const code = scriptTimecode(frame, fps)
      assert.equal(parseScriptTimecode(code, fps), frame, `${frame} at ${fps} → ${code}`)
    }
  }
  assert.equal(scriptTimecode(75, 30), '00:00:02:15')
  assert.equal(parseScriptTimecode('75f', 30), 75)
  assert.match(String(parseScriptTimecode('00:00:02:30', 30)), /frames run 00–29/)
})

test('the rendered line carries id, in → out, source, src and text', () => {
  const p = multiTrack()
  const text = renderScript(p, tlOf(p).id)
  assert.match(text, /^timeline: tl_main$/m)
  assert.match(text, /^rev: [0-9a-f]{8}$/m)
  assert.match(text, /^fps: 30$/m)
  assert.match(text, /^ripple: off$/m)
  assert.match(text, /^## V3 · video · locked · \[trk_v3\]$/m)
  assert.match(text, /^- \[itm_20240001ab\] 00:00:03:00 → 00:00:05:00 · broll · wide\.mov · src 5\.000s$/m)
  assert.match(text, /^- \[itm_20240002aa\] 00:00:00:15 → 00:00:02:00 · text · "Jane Goodall\\nPrimatologist \\"the\\" · \\"one\\""$/m)
  assert.match(text, /^ {2}~ \[trn_1\] cross-dissolve 20f · itm_20240001aa → itm_20240001ab$/m)
  // A still has no source time to state.
  assert.match(text, /^- \[itm_20240004\] 00:00:00:00 → 00:00:02:00 · logo\.png$/m)
})

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test('deleting a line removes that clip and leaves the gap', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => without(l, '[itm_20240001ab]')))
  assert.equal(findItem(tlOf(next), 'itm_20240001ab'), undefined)
  // Nothing else moved: the third clip still starts where it did.
  assert.equal(at_(next, 'itm_20240001ac').from, 150)
  assert.equal(at_(next, 'itm_20240003aa').from, 0)
})

test('ripple: on closes the gap on that track only, and says which tracks it left', () => {
  const p = multiTrack()
  const text = edit(p, (l) => without(replaceIn(l, 'ripple: off', 'off', 'on'), '[itm_20240001ab]'))
  const diff = plan(p, text)
  const next = applied(p, text)
  assert.equal(at_(next, 'itm_20240001ac').from, 90, 'the later clip on V1 slid back by 60')
  // Same picture, now 60 frames earlier: ripple moves a clip, it does not re-cut it.
  assert.equal(sourceTimeAt(at_(next, 'itm_20240001ac'), 90, 30), sourceTimeAt(at_(p, 'itm_20240001ac'), 150, 30))
  assert.equal(at_(next, 'itm_20240002ab').from, 120, 'V2 does not ripple')
  assert.match(diff.notes.join(' '), /V1 only/)
  assert.match(diff.notes.join(' '), /V2, A1, V3 did not move/)
  assert.match(diff.notes.join(' '), /remove_range/)
})

test('ripple: off is the default — the same deletion without it leaves the later clip put', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => without(l, '[itm_20240001ab]')))
  assert.equal(at_(next, 'itm_20240001ac').from, 150)
})

// ---------------------------------------------------------------------------
// Retime
// ---------------------------------------------------------------------------

test('in and out moved together is a move: same length, same source', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240002ab]', '00:00:04:00 → 00:00:06:00', '00:00:04:10 → 00:00:06:10')))
  const moved = at_(next, 'itm_20240002ab')
  assert.equal(moved.from, 130)
  assert.equal(moved.durationInFrames, 60)
  assert.equal(moved.sourceStartUs, 0)
})

test('only in moved is a head trim: the source advances so the picture at out is unchanged', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240001ac]', '00:00:05:00 →', '00:00:06:00 →')))
  const after = at_(next, 'itm_20240001ac')
  const before = at_(p, 'itm_20240001ac')
  assert.equal(after.from, 180)
  assert.equal(itemEnd(after), itemEnd(before))
  // The requirement: every frame still shown shows what it showed before.
  for (const frame of [180, 200, itemEnd(before) - 1]) {
    assert.equal(sourceTimeAt(after, frame, 30), sourceTimeAt(before, frame, 30), `frame ${frame}`)
  }
})

test('only out moved is a tail trim', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240001ac]', '→ 00:00:09:00', '→ 00:00:08:00')))
  const after = at_(next, 'itm_20240001ac')
  assert.equal(after.from, 150)
  assert.equal(after.durationInFrames, 90)
  assert.equal(after.sourceStartUs, 30_000_000)
})

test('a head trim accepts a frame number as well as a timecode', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240001ac]', '00:00:05:00 →', '160f →')))
  assert.equal(at_(next, 'itm_20240001ac').from, 160)
})

test('in and out moved by different amounts is refused as ambiguous, and names the way out', () => {
  const p = multiTrack()
  const text = edit(p, (l) => replaceIn(l, '[itm_20240002ab]', '00:00:04:00 → 00:00:06:00', '00:00:04:10 → 00:00:06:20'))
  const line = text.split('\n').findIndex((l) => l.includes('[itm_20240002ab]')) + 1
  const error = refusal(p, text)
  assert.match(error, new RegExp(`Line ${line}:`))
  assert.match(error, /change src/)
  assert.match(error, /Nothing was changed/)
})

test('changing src with the timecodes reads the line literally — a slip, or an explicit trim', () => {
  const p = multiTrack()
  const slipped = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240001ab]', 'src 5.000s', 'src 7.500s')))
  assert.equal(at_(slipped, 'itm_20240001ab').sourceStartUs, 7_500_000)
  assert.equal(at_(slipped, 'itm_20240001ab').from, 90)

  // The ambiguous edit above becomes legal once src says which frame plays at in.
  const explicit = applied(
    p,
    edit(p, (l) =>
      replaceIn(l, '[itm_20240001ac]', '00:00:05:00 → 00:00:09:00 · goodall.mp4 · src 30.000s', '00:00:05:10 → 00:00:08:20 · goodall.mp4 · src 31.000s')
    )
  )
  const after = at_(explicit, 'itm_20240001ac')
  assert.deepEqual([after.from, itemEnd(after), after.sourceStartUs], [160, 260, 31_000_000])
})

test('a head trim past the start of the source is refused with the furthest it can go', () => {
  const q = multiTrack()
  at_(q, 'itm_20240001ab').sourceStartUs = 1_000_000 // one second, 30 frames of handle
  // The clip before it and their dissolve go, so the only thing in the way is the source.
  const clear = (lines: string[]): string[] => without(without(lines, '[itm_20240001aa]'), '[trn_1]')
  const over = edit(q, (l) => replaceIn(clear(l), '[itm_20240001ab]', '00:00:03:00 →', '00:00:01:29 →'))
  const error = refusal(q, over)
  assert.match(error, /at most 30 frames, to 00:00:02:00/)
  // Positive control: exactly the handle is fine.
  const exact = edit(q, (l) => replaceIn(clear(l), '[itm_20240001ab]', '00:00:03:00 →', '00:00:02:00 →'))
  assert.equal(applied(q, exact).timelines[0]!.tracks[0]!.items.find((i) => i.id === 'itm_20240001ab')!.sourceStartUs, 0)
})

test('a tail trim past the end of the source is refused with the latest out it allows', () => {
  const p = multiTrack()
  // broll is 20s long and this clip reads from 5s: 15s = 450 frames, so out ≤ 90 + 450 = 540.
  const clear = (lines: string[]): string[] => without(without(lines, '[itm_20240001ac]'), '[trn_1]')
  const over = edit(p, (l) => replaceIn(clear(l), '[itm_20240001ab]', '→ 00:00:05:00', '→ 00:00:18:01'))
  assert.match(refusal(p, over), /out can be at most 00:00:18:00/)
  const exact = edit(p, (l) => replaceIn(clear(l), '[itm_20240001ab]', '→ 00:00:05:00', '→ 00:00:18:00'))
  assert.equal(itemEnd(at_(applied(p, exact), 'itm_20240001ab')), 540)
})

test('an edit that makes two clips overlap is refused, naming both lines and the free frame', () => {
  const p = multiTrack()
  const text = edit(p, (l) => replaceIn(l, '[itm_20240002ab]', '→ 00:00:06:00', '→ 00:00:07:00'))
  const lines = text.split('\n')
  const a = lines.findIndex((l) => l.includes('[itm_20240002ab]')) + 1
  const b = lines.findIndex((l) => l.includes('[itm_20240002ac]')) + 1
  const error = refusal(p, text)
  assert.match(error, new RegExp(`line ${a} \\[itm_20240002ab\\]`))
  assert.match(error, new RegExp(`line ${b} \\[itm_20240002ac\\]`))
  assert.match(error, /end the first by 00:00:06:20/)
  // Positive control: ending exactly where the next begins is legal (half-open).
  const flush = edit(p, (l) => replaceIn(l, '[itm_20240002ab]', '→ 00:00:06:00', '→ 00:00:06:20'))
  assert.equal(itemEnd(at_(applied(p, flush), 'itm_20240002ab')), 200)
})

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

test('reordering lines resequences the track end to end from its first start', () => {
  const p = multiTrack()
  const text = edit(p, (l) => {
    const first = at(l, '[itm_20240002aa]')
    const third = at(l, '[itm_20240002ac]')
    const out = [...l]
    out[first] = l[third]!
    out[third] = l[first]!
    return out
  })
  const next = applied(p, text)
  // Written order is now ac, ab, aa; the track started at 15.
  assert.deepEqual(
    ['itm_20240002ac', 'itm_20240002ab', 'itm_20240002aa'].map((id) => [at_(next, id).from, at_(next, id).durationInFrames]),
    [[15, 40], [55, 60], [115, 45]]
  )
  // Resequencing moves a clip; it does not re-cut it.
  assert.equal(at_(next, 'itm_20240002ab').sourceStartUs, 0)
})

test('a reorder that splits a dissolved pair removes the transition and says why', () => {
  const p = multiTrack()
  const text = edit(p, (l) => {
    const a = at(l, '[itm_20240001aa]')
    const c = at(l, '[itm_20240001ac]')
    const out = [...l]
    out[a] = l[c]!
    out[c] = l[a]!
    return out
  })
  const diff = plan(p, text)
  const next = applied(p, text)
  assert.deepEqual(tlOf(next).transitions, [])
  const summary = diff.operations.map((o) => o.summary).join('\n')
  assert.match(summary, /Removed cross-dissolve \[trn_1\]: .*no longer meet/)
  assert.match(summary, /add_transition/)
})

test('a trim that keeps the pair abutting keeps the transition', () => {
  // The positive control for the removal above: only a broken junction is removed.
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240001ac]', '→ 00:00:09:00', '→ 00:00:08:00')))
  assert.equal(tlOf(next).transitions?.length, 1)
})

test('a tail trim that opens a gap at a dissolve removes it', () => {
  const p = multiTrack()
  const text = edit(p, (l) => replaceIn(l, '[itm_20240001aa]', '→ 00:00:03:00', '→ 00:00:02:20'))
  assert.deepEqual(tlOf(applied(p, text)).transitions, [])
})

test('reordering and retiming one track in one submission is refused', () => {
  const p = multiTrack()
  const text = edit(p, (l) => {
    const swapped = [...l]
    const a = at(l, '[itm_20240002aa]')
    const b = at(l, '[itm_20240002ab]')
    swapped[a] = l[b]!
    swapped[b] = l[a]!
    return replaceIn(swapped, '[itm_20240002ac]', '→ 00:00:08:00', '→ 00:00:07:20')
  })
  assert.match(refusal(p, text), /V2: the clips were reordered .* reorder in one submission and retime in the next/)
})

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

test('changing the quoted text rewrites that title, escapes and all', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240002aa]', 'Jane Goodall\\n', 'Dr Jane Goodall\\n')))
  const title = next.assets.find((a) => a.id === at_(next, 'itm_20240002aa').assetId)!
  assert.equal(title.text, 'Dr Jane Goodall\nPrimatologist "the" · "one"')
  assert.equal(title.id, 'ast_title', 'an unshared asset is edited in place')
  assert.equal(title.name, 'Dr Jane Goodall', 'a derived name follows the words')
})

test('changing one of two clips that share a text asset leaves the other alone', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240002ac]', '"Gombe, 1960"', '"Gombe, 1961"')))
  const changed = next.assets.find((a) => a.id === at_(next, 'itm_20240002ac').assetId)!
  const other = next.assets.find((a) => a.id === at_(next, 'itm_20240002ab').assetId)!
  assert.equal(changed.text, 'Gombe, 1961')
  assert.equal(other.text, 'Gombe, 1960')
  assert.notEqual(changed.id, other.id)
})

test('emptying a title is refused and says to delete the line instead', () => {
  const p = multiTrack()
  assert.match(refusal(p, edit(p, (l) => replaceIn(l, '[itm_20240002ab]', '"Gombe, 1960"', '""'))), /Delete the line/)
})

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

test('deleting a transition line removes the transition and moves nothing', () => {
  const p = multiTrack()
  const next = applied(p, edit(p, (l) => without(l, '[trn_1]')))
  assert.deepEqual(tlOf(next).transitions, [])
  assert.deepEqual(tlOf(next).tracks, tlOf(p).tracks)
})

test('an edited transition line is refused and points at add_transition', () => {
  const p = multiTrack()
  const error = refusal(p, edit(p, (l) => replaceIn(l, '[trn_1]', '20f', '30f')))
  assert.match(error, /kept or deleted, not edited/)
  assert.match(error, /add_transition/)
})

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

function lineOf(text: string, needle: string): number {
  return text.split('\n').findIndex((l) => l.includes(needle)) + 1
}

test('a new line without an id is refused with its line number and where new clips come from', () => {
  const p = multiTrack()
  const text = edit(p, (l) => {
    const out = [...l]
    out.splice(at(l, '[itm_20240002ac]') + 1, 0, '- 00:00:09:00 → 00:00:10:00 · text · "New"')
    return out
  })
  const error = refusal(p, text)
  assert.match(error, new RegExp(`Line ${lineOf(text, '"New"')}:`))
  assert.match(error, /place_asset/)
})

test('an id that names nothing is refused; a unique prefix of a real one is accepted', () => {
  const p = multiTrack()
  const bogus = edit(p, (l) => replaceIn(l, '[itm_20240002ab]', 'itm_20240002ab', 'itm_zzzz'))
  const error = refusal(p, bogus)
  assert.match(error, new RegExp(`Line ${lineOf(bogus, 'itm_zzzz')}: \\[itm_zzzz\\] is not an id`))
  // Rendered ids are the shortest unique prefix, so a real id is often longer than its line
  // shows. Positive control: the full id where the short one was rendered names the same clip.
  const full = edit(p, (l) => replaceIn(l, '[itm_20240003]', '[itm_20240003]', '[itm_20240003aa]'))
  assert.deepEqual(plan(p, full).operations, [])
  // And a prefix that fits several is refused with how many, not resolved to the first.
  const ambiguous = edit(p, (l) => replaceIn(l, '[itm_20240002ab]', 'itm_20240002ab', 'itm_20240002'))
  assert.match(refusal(p, ambiguous), /\[itm_20240002\] matches 3 ids; use more of it/)
})

test('a changed source name is refused, naming the line', () => {
  const p = multiTrack()
  const text = edit(p, (l) => replaceIn(l, '[itm_20240001ab]', 'broll · wide.mov', 'other.mov'))
  const error = refusal(p, text)
  assert.match(error, new RegExp(`Line ${lineOf(text, 'other.mov')}: the source "broll · wide.mov" was changed`))
})

test('a clip moved into another track section is refused and points at edit_item', () => {
  const p = multiTrack()
  const text = edit(p, (l) => {
    const i = at(l, '[itm_20240002ac]')
    const out = l.filter((_, index) => index !== i)
    out.splice(at(out, '## A1') + 1, 0, l[i]!)
    return out
  })
  const error = refusal(p, text)
  assert.match(error, /is on V2 but was written under A1/)
  assert.match(error, /edit_item with trackId/)
})

test('a missing track section is refused rather than read as deleting the track', () => {
  const p = multiTrack()
  const text = edit(p, (l) => {
    const start = at(l, '## A1')
    return l.filter((_, i) => i < start || i > start + 1)
  })
  const error = refusal(p, text)
  assert.match(error, /no section for A1 \[trk_a1\]/)
  // Positive control: the header kept and its lines deleted empties the track.
  const emptied = edit(p, (l) => without(l, '[itm_20240003]'))
  assert.deepEqual(tlOf(applied(p, emptied)).tracks.find((t) => t.id === 'trk_a1')!.items, [])
})

test('an edited track header is refused with the header to restore', () => {
  const p = multiTrack()
  const error = refusal(p, edit(p, (l) => replaceIn(l, '## A1', 'A1 ·', 'Music ·')))
  assert.match(error, /restore it to `## A1 · audio · \[trk_a1\]`/)
})

test('anything on a locked track is refused; the same edit on an unlocked one is not', () => {
  const p = multiTrack()
  const deleted = refusal(p, edit(p, (l) => without(l, '[itm_20240004]')))
  assert.match(deleted, /V3 is locked/)
  const moved = refusal(p, edit(p, (l) => replaceIn(l, '[itm_20240004]', '00:00:00:00 → 00:00:02:00', '00:00:00:10 → 00:00:02:10')))
  assert.match(moved, /V3 is locked/)
  const q = clone(p)
  tlOf(q).tracks.find((t) => t.id === 'trk_v3')!.locked = false
  assert.equal(findItem(tlOf(applied(q, edit(q, (l) => without(l, '[itm_20240004]')))), 'itm_20240004aa'), undefined)
})

test('a script read before the timeline changed is refused, and says to read again', () => {
  const p = multiTrack()
  const stale = edit(p, (l) => without(l, '[itm_20240002ab]'))
  const moved = clone(p)
  at_(moved, 'itm_20240002ac').from = 210 // someone nudged a clip after the read
  const error = refusal(moved, stale)
  assert.match(error, /changed since this script was read/)
  assert.match(error, /read_script again/)
  // Positive control: the same edit against the timeline it was read from applies.
  assert.equal(plan(p, stale).operations.length, 1)
})

test('a missing header is refused; a script for another timeline is refused', () => {
  const p = multiTrack()
  assert.match(refusal(p, edit(p, (l) => without(l, 'rev: '))), /"rev:" header line is missing/)
  const other = edit(p, (l) => replaceIn(l, 'timeline: tl_main', 'tl_main', 'tl_other'))
  assert.match(refusal(p, other), /for timeline tl_other, but the active timeline is tl_main/)
})

test('free-form lines are refused, but notes, blank lines and markdown rules are allowed', () => {
  const p = multiTrack()
  const prose = edit(p, (l) => [...l, 'Cut the second shot please'])
  assert.match(refusal(p, prose), /is not something a script can contain/)
  const annotated = edit(p, (l) => [...l, '', '> my note', '---', '<!-- comment -->'])
  assert.deepEqual(plan(p, annotated).operations, [])
})

test('several edits in one script all land, and are reported one per line', () => {
  const p = multiTrack()
  const text = edit(p, (l) =>
    replaceIn(
      without(without(l, '[itm_20240002ac]'), '[trn_1]'),
      '[itm_20240002aa]',
      '"Jane Goodall\\n',
      '"Jane\\n'
    )
  )
  const diff = plan(p, text)
  assert.deepEqual(diff.operations.map((o) => o.op).sort(), ['delete', 'removeTransition', 'setText'])
  for (const op of diff.operations) assert.ok(op.summary.length > 20, op.summary)
})

test('fades are clamped to a trimmed clip, as the store does', () => {
  const p = multiTrack()
  at_(p, 'itm_20240001ac').fadeOutFrames = 100
  const next = applied(p, edit(p, (l) => replaceIn(l, '[itm_20240001ac]', '→ 00:00:09:00', '→ 00:00:07:00')))
  assert.equal(at_(next, 'itm_20240001ac').fadeOutFrames, 60)
})
