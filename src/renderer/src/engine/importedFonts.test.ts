/**
 * The imported-font registry and its seam with the variation faces — the half that runs without
 * a browser. The pixels (an imported Archivo's wdth axis measured on the canvas, preview against
 * export, and after reopening) are `test/app/fonts.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ImportedFonts, type FaceEnv } from './importedFonts'
import { VariationFaces, type FaceSource, type FontEnv } from './brfFonts'
import type { Asset, FontInfo } from '@shared/project'

function font(id: string, family: string, path = `/fonts/${id}.ttf`, over: Partial<FontInfo> = {}): Asset {
  return {
    id,
    kind: 'font',
    name: `${family}.ttf`,
    path,
    durationUs: 0,
    width: null,
    height: null,
    fps: null,
    hasAudio: false,
    hasVideo: false,
    posterPath: null,
    waveformPath: null,
    createdAt: 0,
    font: {
      family,
      fullName: null,
      postscriptName: null,
      weight: '100 900',
      stretch: '62% 125%',
      style: 'normal',
      axes: [{ tag: 'wdth', min: 62, default: 100, max: 125 }],
      format: 'truetype',
      importedFrom: `/src/${id}.ttf`,
      ...over
    }
  }
}

/** A page stand-in whose loads resolve when the test says. */
function env(): FaceEnv & { loads: { family: string; source: string; descriptors: Record<string, string>; resolve(): void }[]; removed: unknown[] } {
  const loads: { family: string; source: string; descriptors: Record<string, string>; resolve(): void }[] = []
  const removed: unknown[] = []
  return {
    loads,
    removed,
    load(family, source, descriptors) {
      let resolve!: () => void
      const loaded = new Promise<void>((r) => (resolve = r))
      const handle = { family }
      loads.push({ family, source, descriptors, resolve })
      return { handle, loaded }
    },
    remove(handle) {
      removed.push(handle)
    }
  }
}

test('a font asset registers once, from bay://, with its axis ranges — and is pending until it loads', async () => {
  const page = env()
  const fonts = new ImportedFonts(page)
  const assets = [font('a', 'Archivo')]
  fonts.sync(assets)
  fonts.sync(assets)
  assert.equal(page.loads.length, 1, 'an unchanged set registers nothing more')
  const load = page.loads[0]!
  assert.match(load.source, /^url\("bay:\/\/media\/[A-Za-z0-9_-]+"\) format\("truetype"\)$/)
  assert.deepEqual(load.descriptors, { weight: '100 900', stretch: '62% 125%', style: 'normal' })
  assert.equal(fonts.isLoading('"Archivo", sans-serif'), true, 'drawn now, this would be a fallback face')
  assert.equal(fonts.isLoading('Georgia, serif'), false, 'a family it does not hold is not its to wait on')
  load.resolve()
  await fonts.settle(1000)
  assert.equal(fonts.isLoading('"Archivo", sans-serif'), false)
  assert.deepEqual(fonts.sourcesFor('"Archivo"').map((s) => s.stretch), ['62% 125%'])
  assert.deepEqual(fonts.compositionFonts(), [{ family: 'Archivo', path: '/fonts/a.ttf', weight: '100 900', stretch: '62% 125%', style: 'normal', format: 'truetype' }])
})

test('removing the asset unregisters its face; a malformed font is never registered', () => {
  const page = env()
  const fonts = new ImportedFonts(page)
  fonts.sync([font('a', 'Archivo'), font('b', 'Evil', '/fonts/b.ttf', { weight: '400; } body { color: red' })])
  assert.deepEqual(page.loads.map((l) => l.family), ['Archivo'])
  fonts.sync([])
  assert.equal(page.removed.length, 1)
  assert.deepEqual(fonts.families(), [])
})

test('a variation face clones the imported source; the refusal names imported fonts; importing clears an old refusal', async () => {
  const fonts = new ImportedFonts(env())
  const loaded: { family: string; source: FaceSource; settings: string }[] = []
  const faceEnv: FontEnv = {
    rulesFor: (family) => fonts.sourcesFor(family),
    families: () => ['Inter Variable', ...fonts.families()],
    importedFamilies: () => fonts.families(),
    load: async (family, source, settings) => {
      if (!source.src.startsWith('url(')) throw new Error('local() finds nothing here')
      loaded.push({ family, source, settings })
    },
    remove: () => {}
  }
  const faces = new VariationFaces(faceEnv)
  fonts.onChange((families) => faces.forget(families))

  // Before the import: refused, and the refusal says what there is and how to add one.
  assert.deepEqual(faces.resolve('Archivo', { wdth: 62 }), { pending: true })
  await faces.settle(1000)
  const refused = faces.resolve('Archivo', { wdth: 62 })
  assert.ok('error' in refused)
  assert.match(refused.error, /not a font this project imported \(none — import_media/)

  fonts.sync([font('a', 'Archivo'), font('c', 'Space Grotesk', '/fonts/c.ttf')])
  // The refusal was forgotten when the font arrived: asking again loads from the imported file.
  assert.deepEqual(faces.resolve('Archivo', { wdth: 62 }), { pending: true })
  await faces.settle(1000)
  const drawn = faces.resolve('Archivo', { wdth: 62 })
  assert.ok('font' in drawn, JSON.stringify(drawn))
  assert.equal(loaded[0]?.settings, '"wdth" 62')
  assert.match(loaded[0]?.source.src ?? '', /^url\("bay:\/\//)

  // A family nobody has: the refusal names the imported ones first, then bay's.
  faces.resolve('Nope', { wght: 700 })
  await faces.settle(1000)
  const nope = faces.resolve('Nope', { wght: 700 })
  assert.ok('error' in nope)
  assert.match(nope.error, /not a font this project imported \("Archivo", "Space Grotesk"\), not one of bay's fonts \("Inter Variable"\)/)
})
