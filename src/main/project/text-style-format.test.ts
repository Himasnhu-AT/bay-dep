/**
 * The paint stack, animation presets and the newer keyable properties are additive optional
 * fields of the version-1 `.bay` format (CLAUDE.md: a new optional field needs no bump). These
 * load literal documents through the real load path and check two things a round trip through
 * today's writer and reader could not: a title written before any of this existed comes back
 * byte for byte — no key added, moved or defaulted in — and a title carrying the new fields
 * keeps them.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROJECT_VERSION, type Item, type Project } from '@shared/project'
import { V1_ON_DISK } from '@shared/project-fixtures'
import { textPaintOf, usesTextLayers } from '@shared/text-style'
import { animatedItemAt } from '@shared/keyframes'
import { migrate } from './persistence'

/**
 * A text asset and a styled title as a build before the paint stack wrote them. Spelled out key
 * by key: the reader that must keep loading this is on users' disks and cannot be updated.
 */
const OLD_TEXT_ASSET =
  '{"id":"asset_title","kind":"text","name":"Chapter one","path":null,"durationUs":0,"width":null,"height":null,' +
  '"fps":null,"hasAudio":false,"hasVideo":false,"posterPath":null,"waveformPath":null,"createdAt":1700000000000,"text":"Chapter one"}'

const OLD_TITLE =
  '{"id":"item_title","assetId":"asset_title","trackId":"trk_v1","from":150,"durationInFrames":90,"sourceStartUs":0,' +
  '"layout":{"left":90,"top":1400,"width":900,"height":300,"opacity":1,"rotation":0},"volume":1,"fadeInFrames":0,' +
  '"fadeOutFrames":0,"speed":1,"text":{"fontFamily":"Georgia, serif","fontSize":72,"fontWeight":700,"italic":false,' +
  '"color":"#FFEEDD","align":"left","verticalAlign":"bottom","lineHeight":1.1,"letterSpacing":2,' +
  '"stroke":{"color":"#000000","width":6},"shadow":{"color":"#00000080","blur":12,"offsetX":0,"offsetY":4},' +
  '"background":{"color":"#101010","padding":20,"radius":8}},"keyframes":{"opacity":[{"frame":0,"value":0},{"frame":12,"value":1}]}}'

function documentWith(title: string): unknown {
  const raw = JSON.parse(V1_ON_DISK) as Project
  raw.assets.push(JSON.parse(OLD_TEXT_ASSET) as Project['assets'][number])
  raw.timelines[0]!.tracks[0]!.items.push(JSON.parse(title) as Item)
  // Through JSON, as a file on disk is.
  return JSON.parse(JSON.stringify(raw))
}

const titleOf = (project: Project): Item => project.timelines[0]!.tracks[0]!.items.find((item) => item.id === 'item_title')!

test('these are still version-1 fields: adding them needed no format bump', () => {
  // If this fails, the version moved — and a bump needs a migration and a fixture, not this test.
  assert.equal(PROJECT_VERSION, 1)
})

test('a title written before the paint stack loads and saves byte for byte', () => {
  const loaded = migrate(documentWith(OLD_TITLE), '/tmp/old-title.bay')
  assert.equal(JSON.stringify(titleOf(loaded)), OLD_TITLE)
  assert.equal(usesTextLayers(titleOf(loaded).text!), false)
  assert.equal('animation' in titleOf(loaded), false)
  // And it paints the four things it always did: one plate, one shadow, one outline, one fill.
  const paint = textPaintOf(titleOf(loaded).text!)
  assert.deepEqual([paint.plate !== null, paint.shadows.length, paint.strokes.length, paint.fills.length], [true, 1, 1, 1])
})

test('a title carrying the stack, presets and newer keys loads with all of them, and saves the same bytes', () => {
  const rich = JSON.parse(OLD_TITLE) as Item
  rich.text = {
    ...rich.text!,
    fills: [{ kind: 'linear', angle: 90, stops: [{ at: 0, color: '#FFD36E' }, { at: 1, color: '#7A5CFF' }] }],
    strokes: [{ color: '#FFFFFF', width: 4, join: 'miter' }],
    shadows: [{ color: '#000000', blur: 0, offsetX: 4, offsetY: 4 }],
    glow: { color: '#39E6FF', blur: 30, strength: 3 },
    plate: { perLine: true, paddingX: 24 }
  }
  rich.animation = { in: { kind: 'rise', frames: 18, by: 'word' }, out: { kind: 'fade', frames: 9 }, loop: { kind: 'float', frames: 60 } }
  rich.keyframes = { ...rich.keyframes, fontSize: [{ frame: 0, value: 60 }, { frame: 90, value: 80 }], blur: [{ frame: 0, value: 12 }, { frame: 10, value: 0 }] }
  const onDisk = JSON.stringify(rich)
  const loaded = titleOf(migrate(documentWith(onDisk), '/tmp/rich-title.bay'))
  assert.equal(JSON.stringify(loaded), onDisk)
  // Not merely carried: it draws with them.
  const paint = textPaintOf(loaded.text!)
  assert.equal(paint.shadows.length, 3 + 1 + 1, 'three layers of glow, the single shadow, the extra one')
  assert.deepEqual(paint.strokes.map((stroke) => stroke.lineWidth), [10, 6])
  assert.equal(animatedItemAt(loaded, loaded.from + 45).text?.fontSize, 70)
})

test('a damaged layer (a NaN saved as null) loads, and the rest of the title still paints', () => {
  const damaged = JSON.parse(OLD_TITLE) as Item
  damaged.text = { ...damaged.text!, strokes: [{ color: '#FFFFFF', width: Number.NaN }], glow: { color: '#39E6FF', blur: Number.NaN } }
  const specimen = JSON.parse(JSON.stringify(damaged)) as { text: { strokes: { width: unknown }[] } }
  assert.equal(specimen.text.strokes[0]!.width, null, 'the specimen must be what JSON.stringify makes of NaN')
  const loaded = titleOf(migrate(documentWith(JSON.stringify(damaged)), '/tmp/damaged-title.bay'))
  const paint = textPaintOf(loaded.text!)
  assert.deepEqual(paint.strokes.map((stroke) => stroke.lineWidth), [6], 'the broken outline is not drawn; the single one is')
  assert.equal(paint.shadows.length, 1, 'the broken glow is not drawn; the shadow is')
  assert.equal(paint.fills.length, 1)
})
