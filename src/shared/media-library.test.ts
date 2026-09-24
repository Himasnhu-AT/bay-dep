/**
 * The Media panel's search, kind filter, sort and usage counts.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assetFacts,
  filterAssets,
  formatFileSize,
  formatFps,
  kindGroup,
  isCaptionAsset,
  MEDIA_KIND_GROUPS,
  mediaPoolAssets,
  reusedInProject,
  sortAssets,
  usageCounts
} from './media-library'
import type { Asset, AssetKind, Project } from './project'

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/media/${id}.mp4`,
    durationUs: 1_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0,
    ...over
  }
}

test('every asset kind belongs to a group the filter offers', () => {
  const kinds: AssetKind[] = ['video', 'audio', 'image', 'gif', 'text', 'html', 'brf', 'lut', 'font']
  const offered = new Set(MEDIA_KIND_GROUPS.map((group) => group.id))
  for (const kind of kinds) assert.ok(offered.has(kindGroup(kind)), `${kind} has no filter`)
  // A GIF is found under Images and an HTML file under Compositions — what a person calls them.
  assert.equal(kindGroup('gif'), 'image')
  assert.equal(kindGroup('html'), 'composition')
})

test('search matches every word, in any order, ignoring case and accents', () => {
  const assets = [
    asset('a', { name: 'Café interview B-roll' }),
    asset('b', { name: 'Interview wide' }),
    asset('c', { name: 'Music bed', kind: 'audio' })
  ]
  const names = (query: string): string[] => filterAssets(assets, { query, kind: 'all' }).map((a) => a.id)
  assert.deepEqual(names('interview cafe'), ['a'])
  assert.deepEqual(names('INTERVIEW'), ['a', 'b'])
  // The positive control for the empty query: nothing typed filters nothing.
  assert.deepEqual(names('   '), ['a', 'b', 'c'])
  assert.deepEqual(names('nothing like this'), [])
})

test('a renamed asset is still found by its file name, and a text asset by its words', () => {
  const renamed = asset('a', { name: 'Opening shot', path: '/shoot/A001_C003.mov' })
  const title = asset('t', { kind: 'text', name: 'Title', path: null, text: 'Chapter one' })
  assert.deepEqual(filterAssets([renamed, title], { query: 'a001', kind: 'all' }).map((a) => a.id), ['a'])
  assert.deepEqual(filterAssets([renamed, title], { query: 'chapter', kind: 'all' }).map((a) => a.id), ['t'])
})

test('the kind filter narrows to its group and "all" keeps everything', () => {
  const assets = [asset('v'), asset('g', { kind: 'gif' }), asset('i', { kind: 'image' }), asset('m', { kind: 'audio' })]
  assert.deepEqual(filterAssets(assets, { query: '', kind: 'image' }).map((a) => a.id), ['g', 'i'])
  assert.deepEqual(filterAssets(assets, { query: '', kind: 'all' }).map((a) => a.id), ['v', 'g', 'i', 'm'])
})

test('sorts: newest first, longest first, by name numerically, by kind in filter order', () => {
  const assets = [
    asset('x', { name: 'clip 10', createdAt: 3, durationUs: 5_000_000 }),
    asset('y', { name: 'clip 2', createdAt: 1, durationUs: 9_000_000, kind: 'audio' }),
    asset('z', { name: 'Clip 1', createdAt: 2, durationUs: 0, kind: 'image' })
  ]
  const ids = (sort: Parameters<typeof sortAssets>[1]): string[] => sortAssets(assets, sort).map((a) => a.id)
  assert.deepEqual(ids('added'), ['x', 'z', 'y'])
  // The project's own order is untouched by a sort that reorders it.
  assert.deepEqual(assets.map((a) => a.id), ['x', 'y', 'z'])
  assert.deepEqual(ids('duration'), ['y', 'x', 'z'])
  // "clip 2" before "clip 10": a sort by characters puts 10 first, which nobody means.
  assert.deepEqual(ids('name'), ['z', 'y', 'x'])
  assert.deepEqual(ids('kind'), ['x', 'y', 'z'])
})

test('usage counts every placement on every timeline', () => {
  const item = (id: string, assetId: string) => ({ id, assetId }) as never
  const project = {
    timelines: [
      { tracks: [{ items: [item('1', 'a'), item('2', 'a')] }, { items: [item('3', 'b')] }] },
      { tracks: [{ items: [item('4', 'a')] }] }
    ]
  } as unknown as Pick<Project, 'timelines'>
  const counts = usageCounts(project)
  assert.equal(counts.get('a'), 3)
  assert.equal(counts.get('b'), 1)
  assert.equal(counts.get('unused'), undefined)
})

test('file sizes and frame rates read the way people write them', () => {
  assert.equal(formatFileSize(812), '812 B')
  assert.equal(formatFileSize(812_000), '812 KB')
  assert.equal(formatFileSize(14_230_000), '14.2 MB')
  assert.equal(formatFileSize(1_300_000_000), '1.3 GB')
  assert.equal(formatFps(30), '30 fps')
  assert.equal(formatFps(30000 / 1001), '29.97 fps')
  assert.equal(formatFps(24000 / 1001), '23.976 fps')
})

test('facts name size, rate, sound and file size, and only what the asset has', () => {
  assert.deepEqual(assetFacts(asset('v'), 14_230_000), ['1920×1080', '30 fps', 'with sound', '14.2 MB'])
  assert.deepEqual(assetFacts(asset('m', { kind: 'audio', width: null, height: null, fps: null, hasVideo: false })), [])
})

test('a sound card says mono or stereo when the asset knows, and nothing when it does not', () => {
  const sound = (channels?: number) =>
    asset('s', { kind: 'audio', width: null, height: null, fps: null, hasVideo: false, ...(channels ? { channels } : {}) })
  assert.deepEqual(assetFacts(sound(1), 353_000), ['Mono', '353 KB'])
  assert.deepEqual(assetFacts(sound(2)), ['Stereo'])
  assert.deepEqual(assetFacts(sound(6)), ['6 ch'])
  // An asset imported before channels were recorded shows nothing, not a guess.
  assert.deepEqual(assetFacts(sound()), [])
})

test('a card names a tempo only for a steady beat; a failed detection reads "No steady beat"', () => {
  const beats = (confidence: number, bpm: number) => ({
    version: 1,
    bpm,
    confidence,
    beatsPerBar: 4,
    beatsUs: [500_000, 1_000_000, 1_500_000],
    downbeatsUs: [],
    downbeatConfidence: 0,
    dropouts: []
  })
  const audio = { kind: 'audio', width: null, height: null, fps: null, hasVideo: false } as const
  assert.deepEqual(assetFacts(asset('m', { ...audio, beats: beats(0, 178.4) })), ['No steady beat'])
  assert.deepEqual(assetFacts(asset('m', { ...audio, beats: beats(0.9, 120) })), ['120 BPM'])
})

test('placed caption lines are not Media cards; footage, titles and unused lines are', () => {
  const text = (id: string, words: string, over: Partial<Asset> = {}) =>
    asset(id, { kind: 'text', path: null, text: words, name: `Caption: ${words}`, ...over })
  const all = [
    asset('clip'),
    text('c1', 'Hello there', { caption: true }),
    text('c2', 'this is a test', { caption: true }),
    // From a project saved before the mark: recognised by the name add_captions gave it.
    text('legacy', 'Old line'),
    text('title', 'Opening title', { name: 'Opening title' }),
    text('orphan', 'Deleted track', { caption: true })
  ]
  const uses = new Map([
    ['clip', 1],
    ['c1', 2],
    ['c2', 1],
    ['legacy', 1],
    ['title', 1]
  ])
  assert.deepEqual(
    mediaPoolAssets(all, uses).map((a) => a.id),
    ['clip', 'title', 'orphan']
  )
  // The fallback is the add_captions name for the asset's own words, not any "Caption:" prefix:
  // a title someone named that way, whose words differ, stays.
  const named = text('named', 'Something else', { name: 'Caption: my card' })
  assert.equal(isCaptionAsset(named), false)
  assert.equal(isCaptionAsset(asset('video-named', { name: 'Caption: x' })), false)
})

test('"reused" means already in this project, not probed earlier in the session', () => {
  // Main said reused for clipB because project A imported it; project B does not have it.
  const fromMain = [
    { asset: asset('clipB'), reused: true },
    { asset: asset('clipA'), reused: false }
  ]
  const inB = reusedInProject(fromMain, [asset('other')])
  assert.deepEqual(
    inB.map((entry) => entry.reused),
    [false, false]
  )
  // Positive control: the project that does hold clipB reports it reused, whatever main said.
  const inA = reusedInProject(fromMain, [asset('clipB'), asset('clipA')])
  assert.deepEqual(
    inA.map((entry) => entry.reused),
    [true, true]
  )
})
