/**
 * The agent panel's style tiles: a `search_styles` result → tiles, and the draft "Use this style"
 * puts in the composer.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILT_IN_STYLES, checkStyle, searchStyles, type EditingStyle, type StyleEntry } from './index'
import { readStyleTile, styleDraftMessage, stylePreviewUrl, styleTilesFromResult, type TileCatalogEntry } from './preview'

const builtIn: TileCatalogEntry[] = BUILT_IN_STYLES.map((style) => ({ style, origin: 'built-in' }))
const first = BUILT_IN_STYLES[0]!

function userStyle(id: string, title: string): EditingStyle {
  return {
    id,
    title,
    summary: 'Cut on every breath and hold on the punchline.',
    tags: ['mine', 'talking-head'],
    formats: ['vertical-1080'],
    appliesTo: ['pacing'],
    footage: 'Any talking head.',
    body: '1. transcribe the clip. 2. remove_range every pause over a second.',
    params: {},
    sources: []
  }
}

const mine = userStyle('my-breath-cut', 'My breath cut')
const catalog: TileCatalogEntry[] = [...builtIn, { style: mine, origin: 'user' }]

/** The text the panel receives: bay's socket pretty-prints a tool's value. */
function resultText(entries: readonly StyleEntry[], query?: string): string {
  const styles = searchStyles(entries, query === undefined ? {} : { query })
  return JSON.stringify({ styles, next: `read_style { id: "${styles[0]?.id}" } for its steps and tokens.` }, null, 2)
}

test('a search result becomes tiles in its ranking, built-ins with shipped media URLs', () => {
  const text = resultText(catalog)
  const tiles = styleTilesFromResult(text, catalog)
  assert.deepEqual(
    tiles.map((t) => t.id),
    searchStyles(catalog, {}).map((h) => h.id)
  )
  const tile = tiles.find((t) => t.id === first.id)!
  assert.deepEqual(tile.media, {
    poster: `bay://style-preview/${first.id}/poster.webp`,
    video: `bay://style-preview/${first.id}/preview.webm`
  })
  assert.equal(tile.title, first.title)
  assert.equal(tile.summary, first.summary)
  assert.deepEqual(tile.tags, first.tags)
})

test('a user style is a tile without media, marked as the user\'s', () => {
  const tiles = styleTilesFromResult(resultText(catalog, 'breath'), catalog)
  const tile = tiles.find((t) => t.id === mine.id)
  assert.ok(tile, 'the user style is in the grid')
  assert.equal(tile.origin, 'user')
  assert.equal(tile.media, null)
  // Even one that somehow carries a preview name gets no media: nothing the user saved is served.
  const claiming = [...builtIn, { style: { ...mine, preview: 'preview.webm' }, origin: 'user' as const }]
  assert.equal(styleTilesFromResult(resultText(claiming, 'breath'), claiming).find((t) => t.id === mine.id)?.media, null)
})

test('a built-in with no preview named draws the neutral tile', () => {
  const { preview: _none, ...bare } = first
  const noMedia: TileCatalogEntry[] = [{ style: bare, origin: 'built-in' }]
  const [tile] = styleTilesFromResult(resultText(noMedia), noMedia)
  assert.equal(tile?.id, first.id)
  assert.equal(tile?.media, null)
})

test('a result clamped at 2000 characters still yields its tiles, in order, from the catalog', () => {
  const whole = resultText(catalog)
  assert.ok(whole.length > 2000, 'the specimen must be longer than the clamp, or it tests the whole-JSON path')
  const clamped = `${whole.slice(0, 2000)}…`
  assert.throws(() => JSON.parse(clamped), 'the clamped specimen is not JSON')
  const tiles = styleTilesFromResult(clamped, catalog)
  const ids = searchStyles(catalog, {}).map((h) => h.id)
  assert.ok(tiles.length >= 2, `some tiles survive the clamp (got ${tiles.length})`)
  assert.deepEqual(
    tiles.map((t) => t.id),
    ids.slice(0, tiles.length)
  )
  assert.ok(tiles.every((t) => t.origin === 'built-in' ? t.media !== null : true))
})

test('ids quoted inside strings are not read as hits, and unknown ids without fields are dropped', () => {
  const text = JSON.stringify(
    { styles: [], next: 'read_style { "id": "luxury-minimal" }', skipped: '"id": "ugc-ad"' },
    null,
    2
  ).slice(0, -1) // not JSON any more: forces the id scan
  assert.deepEqual(styleTilesFromResult(text, catalog), [])
  assert.deepEqual(styleTilesFromResult('{\n  "styles": [\n    {\n      "id": "no-such-style"', catalog), [])
  assert.deepEqual(styleTilesFromResult(undefined, catalog), [])
  assert.deepEqual(styleTilesFromResult('not json at all', catalog), [])
})

test('a hit the catalog no longer has is drawn from the result, never with media', () => {
  const gone = userStyle('deleted-since', 'Deleted since')
  const text = resultText([{ style: gone, origin: 'user' }])
  const [tile] = styleTilesFromResult(text, builtIn)
  assert.equal(tile?.id, 'deleted-since')
  assert.equal(tile?.title, 'Deleted since')
  assert.equal(tile?.origin, 'user')
  assert.equal(tile?.media, null)
})

test('preview URLs are built only for a slug id and one of the two served names', () => {
  assert.equal(stylePreviewUrl('ugc-ad', 'poster.webp'), 'bay://style-preview/ugc-ad/poster.webp')
  assert.equal(stylePreviewUrl('../ugc-ad', 'poster.webp'), null)
  assert.equal(stylePreviewUrl('ugc-ad', 'notes.txt'), null)
})

test('read_style shows the tile of the style it was asked for', () => {
  assert.equal(readStyleTile({ id: first.id }, catalog)?.id, first.id)
  assert.equal(readStyleTile({ id: mine.id }, catalog)?.origin, 'user')
  assert.equal(readStyleTile({ id: 'nope' }, catalog), null)
})

test('"Use this style" drafts a message naming the title and the exact id', () => {
  assert.equal(
    styleDraftMessage({ id: 'ugc-ad', title: 'UGC ad / testimonial' }),
    'Apply the UGC ad / testimonial style (`ugc-ad`) to my clip.'
  )
  // A title's line breaks and runs of space do not break the draft into lines.
  assert.equal(styleDraftMessage({ id: 'x-y', title: '  Two\n words ' }), 'Apply the Two words style (`x-y`) to my clip.')
})

test('checkStyle holds a built-in preview to the one served name, and refuses one on a user style', () => {
  const bad = checkStyle({ ...first, preview: '../../etc/poster.webp' }, { origin: 'built-in' })
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.errors.join(' '), /preview must be "preview\.webm"/)
  assert.equal(checkStyle(first, { origin: 'built-in' }).ok, true)
  const user = checkStyle({ ...mine, preview: 'preview.webm' }, { origin: 'user' })
  assert.equal(user.ok, false)
  assert.match(user.ok ? '' : user.errors.join(' '), /Unknown field preview/)
})
