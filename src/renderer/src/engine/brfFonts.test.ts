import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BrfDocument } from '@shared/brf'
import { absoluteSrc, firstFamily, MAX_FACES, VariationFaces, variationRequests, variationSettings, type FaceSource, type FontEnv } from './brfFonts'

/** A page with `rules` as its @font-face fonts; `fails` decides which loads reject. */
function fakeEnv(rules: Record<string, FaceSource[]>, fails: (source: FaceSource) => boolean = () => false) {
  const loads: { family: string; source: FaceSource; settings: string }[] = []
  const removed: string[] = []
  const env: FontEnv = {
    rulesFor: (family) => rules[Object.keys(rules).find((k) => k.toLowerCase() === family.toLowerCase()) ?? ''] ?? [],
    families: () => Object.keys(rules),
    load: async (family, source, settings) => {
      loads.push({ family, source, settings })
      if (fails(source)) throw new Error('A network error occurred.')
    },
    remove: (family) => removed.push(family)
  }
  return { env, loads, removed }
}

const archivo: FaceSource = { src: 'url("file:///app/assets/archivo.ttf") format("truetype")', weight: '100 900', stretch: '62% 125%' }

test('settings are written in tag order, so one set of axes has one spelling', () => {
  assert.equal(variationSettings({ wght: 600, wdth: 87 }), '"wdth" 87, "wght" 600')
  assert.equal(variationSettings({ GRAD: -50 }), '"GRAD" -50')
  assert.equal(firstFamily('"Inter Variable", sans-serif'), 'Inter Variable')
  assert.equal(firstFamily("'Archivo'"), 'Archivo')
})

test('the first ask is pending and starts a load; once loaded, the face leads the author\'s list', async () => {
  const { env, loads } = fakeEnv({ Archivo: [archivo] })
  const faces = new VariationFaces(env)
  assert.deepEqual(faces.resolve('Archivo, sans-serif', { wdth: 87, wght: 600 }), { pending: true })
  assert.equal(loads.length, 1)
  assert.equal(loads[0]!.settings, '"wdth" 87, "wght" 600')
  assert.equal(loads[0]!.source, archivo, 'the rule\'s own source and descriptors are what is loaded')
  await faces.settle(1000)
  const ready = faces.resolve('Archivo, sans-serif', { wght: 600, wdth: 87 })
  assert.ok('font' in ready)
  assert.match(ready.font, /^"__brf_axes_\d+", Archivo, sans-serif$/)
  assert.equal(loads.length, 1, 'the same axes in another order are the same face, not a second load')
  // The nearest different request is a different face.
  assert.deepEqual(faces.resolve('Archivo', { wdth: 88, wght: 600 }), { pending: true })
  assert.equal(loads.length, 2)
})

test('every @font-face rule of the family is cloned, so a font split by unicode-range keeps its ranges', async () => {
  const latin: FaceSource = { src: 'url("a.woff2")', unicodeRange: 'U+0000-00FF' }
  const cyrillic: FaceSource = { src: 'url("b.woff2")', unicodeRange: 'U+0400-045F' }
  const { env, loads } = fakeEnv({ 'Inter Variable': [latin, cyrillic], Other: [archivo] })
  const faces = new VariationFaces(env)
  faces.resolve('"inter variable"', { wght: 300 })
  assert.deepEqual(loads.map((l) => l.source), [latin, cyrillic])
  assert.equal(new Set(loads.map((l) => l.family)).size, 1, 'all under one synthetic family')
  await faces.settle(1000)
})

test('a family with no rule is looked for among installed fonts, by the names local() matches', async () => {
  const { env, loads } = fakeEnv({})
  const faces = new VariationFaces(env)
  faces.resolve('Skia', { wdth: 1.2 })
  assert.equal(loads[0]!.source.src, 'local("Skia"), local("Skia Regular"), local("Skia-Regular")')
  // Wide ranges: a requested weight reaches the font's own axis instead of being clamped or faked.
  assert.equal(loads[0]!.source.weight, '1 1000')
  assert.equal(loads[0]!.source.stretch, '50% 200%')
  await faces.settle(1000)
  assert.ok('font' in faces.resolve('Skia', { wdth: 1.2 }))
})

test('a font nothing can load is refused with what to do instead — never drawn in the plain face', async () => {
  const { env, removed } = fakeEnv({ 'Inter Variable': [archivo], 'JetBrains Mono Variable': [archivo] }, (s) => s.src.startsWith('local('))
  const faces = new VariationFaces(env)
  let ready = 0
  faces.onReady(() => ready++)
  assert.deepEqual(faces.resolve('Archivo', { wdth: 87 }), { pending: true })
  await faces.settle(1000)
  assert.equal(ready, 1, 'a failure is announced too, so a waiting render looks again')
  const refused = faces.resolve('Archivo', { wdth: 87 })
  assert.ok('error' in refused)
  // The message is the recovery: which fonts do work, which names were tried, how to name one.
  assert.match(refused.error, /"Archivo" cannot take variations/)
  assert.match(refused.error, /"Inter Variable", "JetBrains Mono Variable"/)
  assert.match(refused.error, /"Archivo Regular", "Archivo-Regular"/)
  assert.match(refused.error, /full or PostScript name/)
  assert.equal(removed.length, 1, 'the failed face is unregistered')
})

test('one range loading is enough: a family whose other subsets fail still draws', async () => {
  const good: FaceSource = { src: 'url("good.woff2")' }
  const bad: FaceSource = { src: 'url("bad.woff2")' }
  const { env } = fakeEnv({ Split: [bad, good] }, (s) => s === bad)
  const faces = new VariationFaces(env)
  faces.resolve('Split', { wght: 500 })
  await faces.settle(1000)
  assert.ok('font' in faces.resolve('Split', { wght: 500 }))
})

test('faces are bounded: the least recently used is unregistered past MAX_FACES', async () => {
  const { env, removed, loads } = fakeEnv({ Archivo: [archivo] })
  const faces = new VariationFaces(env)
  faces.resolve('Archivo', { wdth: 0 })
  faces.resolve('Archivo', { wdth: 1 })
  faces.resolve('Archivo', { wdth: 0 }) // used again: now the newest
  for (let i = 2; i < MAX_FACES; i++) faces.resolve('Archivo', { wdth: i })
  assert.equal(removed.length, 0, 'exactly MAX_FACES are kept')
  faces.resolve('Archivo', { wdth: MAX_FACES })
  assert.deepEqual(removed, [loads[1]!.family], 'wdth 1 was the least recently used')
  await faces.settle(1000)
  assert.ok('font' in faces.resolve('Archivo', { wdth: 0 }), 'the face used again survived')
})

test('url() in a rule is resolved against its stylesheet; data: stays as it is', () => {
  assert.equal(
    absoluteSrc('url(./inter.woff2) format("woff2-variations"), url(\'x/y.ttf\')', 'file:///app/out/renderer/assets/index.css'),
    'url("file:///app/out/renderer/assets/inter.woff2") format("woff2-variations"), url("file:///app/out/renderer/assets/x/y.ttf")'
  )
  assert.equal(absoluteSrc('url(data:font/ttf;base64,AAAA)', 'file:///a/b.css'), 'url("data:font/ttf;base64,AAAA")')
})

test('verify asks for every distinct (font, axes) the scenes draw, groups included', () => {
  const doc = (layers: unknown[]): BrfDocument => ({ brf: 1, duration: 1, layers }) as BrfDocument
  const wants = variationRequests([
    doc([{ type: 'text', text: 'a', font: 'Archivo', variations: { wdth: 87 } }, { type: 'text', text: 'plain' }]),
    doc([{ type: 'group', layers: [{ type: 'text', text: 'b', font: 'archivo', variations: { wdth: 87 } }, { type: 'text', text: 'c', variations: { wght: 300 } }] }])
  ])
  assert.equal(wants.length, 2, 'the same family and axes twice is one request; text without axes is none')
  assert.deepEqual(wants[0], { font: 'Archivo', variations: { wdth: 87 } })
  assert.equal(wants[1]!.variations.wght, 300)
})
