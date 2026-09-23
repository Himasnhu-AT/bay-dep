/**
 * The shipped templates, checked against the contract the renderer enforces.
 *
 * A template is the one kind of composition bay *vouches for*: an agent is told to fetch it and
 * use it, so a fatal fault here is bay handing out a document it will then refuse to draw. The
 * faults that matter are the silent ones — an unsized root renders a blank frame, a root inside
 * a `<template>` renders nothing at all — so this reads every file the catalog names and asserts
 * `readComposition` finds nothing fatal.
 *
 * It also holds catalog and file to each other in both directions. A template listed with no
 * file is a broken fetch; a file with no listing is a template nobody can discover.
 *
 * Read from disk rather than through `?raw` because this runs under plain Node, where that
 * suffix means nothing. The paths are the same ones `resources.ts` inlines.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readComposition, resolveVariables } from './composition'
import {
  MAX_TEMPLATE_SIDE,
  TEMPLATES,
  TEMPLATE_URI_PREFIX,
  findTemplate,
  sizeTemplate,
  templateFileName,
  templateForUri,
  templateUri
} from './templates'

const DIR = join(process.cwd(), 'src/main/templates')
const bodyOf = (id: string): string => readFileSync(join(DIR, `${id}.html`), 'utf8')

test('every template in the catalog has a file, and every file is in the catalog', () => {
  const onDisk = readdirSync(DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.replace(/\.html$/, ''))
    .sort()
  assert.deepEqual(TEMPLATES.map((t) => t.id).sort(), onDisk)
})

test('every template is renderable — no fatal faults', () => {
  for (const spec of TEMPLATES) {
    const { info, faults } = readComposition(bodyOf(spec.id))
    const fatal = faults.filter((f) => f.fatal)
    assert.deepEqual(
      fatal.map((f) => `${spec.id}: ${f.code} — ${f.message}`),
      [],
      `${spec.id} would render as a blank or wrong frame`
    )
    assert.ok(info, `${spec.id} produced no composition info`)
  }
})

test('the catalog agrees with each file about id, duration and size', () => {
  // Three numbers a reader will trust without checking. A catalog that says 3s over a file
  // that declares 10 makes an agent place a clip at the wrong length, and nothing errors.
  for (const spec of TEMPLATES) {
    const { info } = readComposition(bodyOf(spec.id))
    assert.equal(info?.compositionId, spec.id, `${spec.id}: data-composition-id`)
    assert.equal(info?.durationSeconds, spec.durationSeconds, `${spec.id}: data-duration`)
    assert.equal(info?.width, spec.width, `${spec.id}: width`)
    assert.equal(info?.height, spec.height, `${spec.id}: height`)
  }
})

test('the catalog agrees with each file about the variables it declares, defaults and all', () => {
  // The listing is what an agent reads before deciding what it may set, and the Templates panel
  // draws its fields from it without reading the file. A variable named here and absent there
  // is a call that silently changes nothing; a default that differs is a field showing one
  // value while the clip renders another. So the whole declaration is compared, not the ids.
  for (const spec of TEMPLATES) {
    const { info } = readComposition(bodyOf(spec.id))
    assert.deepEqual(info?.variables, spec.variables, `${spec.id}: declared variables`)
  }
})

test('every declared variable has a usable default', () => {
  // `resolveVariables` with no overrides is what renders on the frame an agent places without
  // setting anything. A missing default there is a blank caption nobody asked for.
  for (const spec of TEMPLATES) {
    const { info } = readComposition(bodyOf(spec.id))
    const values = resolveVariables(info!, {})
    for (const variable of info!.variables) {
      assert.notEqual(values[variable.id], undefined, `${spec.id}.${variable.id} has no default`)
      if (variable.type === 'string') {
        assert.notEqual(String(values[variable.id]).trim(), '', `${spec.id}.${variable.id} is blank`)
      }
    }
  }
})

test('a template registers its timeline under its own id', () => {
  // The seek looks up `window.__timelines[compositionId]`. A file that registers under some
  // other key renders its first frame forever, and `held: true` is the only sign.
  for (const spec of TEMPLATES) {
    assert.match(
      bodyOf(spec.id),
      new RegExp(`__timelines\\['${spec.id}'\\]`),
      `${spec.id} must register window.__timelines['${spec.id}']`
    )
  }
})

test('no template reaches the network', () => {
  // The renderer's CSP permits no remote origin, so a remote font or image is a silent
  // non-render rather than an error.
  for (const spec of TEMPLATES) {
    const body = bodyOf(spec.id)
    assert.doesNotMatch(body, /https?:\/\//, `${spec.id} references a remote origin`)
    assert.doesNotMatch(body, /<script[^>]+src=/, `${spec.id} loads an external script`)
  }
})

test('no template depends on a clock, randomness or input', () => {
  // Determinism is what makes a composition seekable: frame N must be the same picture
  // whenever it is asked for, and an export asks in a different order than a scrub does.
  for (const spec of TEMPLATES) {
    const body = bodyOf(spec.id)
    for (const banned of [/Date\.now/, /new Date/, /Math\.random/, /performance\.now/, /setInterval/]) {
      assert.doesNotMatch(body, banned, `${spec.id} uses ${banned} — its frames would not be stable`)
    }
  }
})

test('uri and id round-trip', () => {
  for (const spec of TEMPLATES) {
    assert.equal(templateForUri(templateUri(spec.id))?.id, spec.id)
    assert.equal(findTemplate(spec.id)?.id, spec.id)
  }
  assert.equal(templateForUri('bay://guide/editing'), undefined)
  assert.equal(templateForUri(`${TEMPLATE_URI_PREFIX}nope`), undefined)
})

// ---------------------------------------------------------------------------
// Sizing to the canvas
// ---------------------------------------------------------------------------

const CANVASES = [
  { name: 'landscape 16:9', width: 1920, height: 1080 },
  { name: 'portrait 9:16', width: 1080, height: 1920 },
  { name: 'square', width: 1080, height: 1080 },
  { name: 'landscape 4K', width: 3840, height: 2160 }
] as const

test('every template sized to a canvas has a root of exactly that canvas', () => {
  // The bug this guards: every template shipped at 1080x1920 and was placed as-is, so on a
  // 16:9 timeline it rendered as a 608px strip down the middle. The landscape canvas is listed
  // first and differs from the shipped size in both numbers, so a sizer that returned the
  // document unchanged fails here rather than passing on the portrait case.
  assert.ok(
    TEMPLATES.every((t) => t.width !== CANVASES[0].width && t.height !== CANVASES[0].height),
    'the landscape case must differ from every shipped size, or it cannot catch a no-op'
  )
  for (const spec of TEMPLATES) {
    for (const canvas of CANVASES) {
      const sized = sizeTemplate(bodyOf(spec.id), canvas.width, canvas.height)
      const { info, faults } = readComposition(sized)
      assert.equal(info?.width, canvas.width, `${spec.id} at ${canvas.name}: width`)
      assert.equal(info?.height, canvas.height, `${spec.id} at ${canvas.name}: height`)
      assert.deepEqual(faults.filter((f) => f.fatal), [], `${spec.id} at ${canvas.name}: fatal faults`)
      // Sizing must not disturb anything an agent or the inspector relies on.
      assert.equal(info?.compositionId, spec.id)
      assert.equal(info?.durationSeconds, spec.durationSeconds)
      assert.deepEqual(info?.variables, spec.variables)
    }
  }
})

test('sizing rewrites the root and nothing else', () => {
  for (const spec of TEMPLATES) {
    const body = bodyOf(spec.id)
    const shipped = `width:${spec.width}px;height:${spec.height}px`
    assert.ok(body.includes(shipped), `${spec.id}: the specimen must carry the shipped size`)
    assert.equal(
      sizeTemplate(body, 1920, 1080),
      body.replace(shipped, 'width:1920px;height:1080px'),
      `${spec.id}`
    )
  }
})

test('the layout inside a template is frame-relative, not fixed pixels', () => {
  // Resizing the root is only half the fix. A template that sized its root to 1920x1080 and
  // kept `left:70px; bottom:420px; font-size:68px` inside would be the right box with the
  // portrait layout pinned into one corner of it. So outside the root's own size, no length in
  // the markup or the CSS may be a pixel literal — lengths are multiples of --u and positions
  // are percentages. Script is exempt: it builds strings like `+ 'px)'` from scaled numbers.
  for (const spec of TEMPLATES) {
    const body = bodyOf(spec.id)
    const markup = body
      .replace(/<script>[\s\S]*?<\/script>/g, '')
      .replace(`width:${spec.width}px;height:${spec.height}px`, '')
    const pixels = markup.match(/\b\d+(?:\.\d+)?px\b/g) ?? []
    assert.deepEqual(pixels, [], `${spec.id} lays out in fixed pixels`)
    // A declared number carrying a pixel unit is the same fault arriving through a variable.
    for (const variable of spec.variables) {
      assert.notEqual(variable.unit, 'px', `${spec.id}.${variable.id} is declared in pixels`)
    }
  }
})

test('sizeTemplate refuses a size it cannot honour, and says what it needs', () => {
  const body = bodyOf('subtitle')
  // Positive controls first: the nearest legal calls succeed.
  assert.doesNotThrow(() => sizeTemplate(body, 1, 1))
  assert.doesNotThrow(() => sizeTemplate(body, MAX_TEMPLATE_SIDE, MAX_TEMPLATE_SIDE))
  const refused: [number, number][] = [
    [0, 1080],
    [1920.5, 1080],
    [1920, Number.NaN],
    [MAX_TEMPLATE_SIDE + 1, 1080]
  ]
  for (const [width, height] of refused) {
    assert.throws(
      () => sizeTemplate(body, width, height),
      (error: Error) => /whole number of pixels from 1 to 8192/.test(error.message),
      `${width}x${height}`
    )
  }
  assert.throws(() => sizeTemplate('<div>no root</div>', 1920, 1080), /no data-composition-id root/)
})

test('sizeTemplate replaces width and height, never a property that ends in them', () => {
  // `line-height` and `max-width` both contain the name being replaced. The specimen puts each
  // before the real declaration so a match not anchored on a boundary hits it first.
  const doc =
    '<div data-composition-id="x" style="max-width:10px;line-height:20px;width:100px;height:50px"></div>'
  assert.equal(/width\s*:\s*[0-9.]+px/.exec(doc)?.[0], 'width:10px', 'specimen must defeat a naive match')
  assert.equal(
    sizeTemplate(doc, 1920, 1080),
    '<div data-composition-id="x" style="max-width:10px;line-height:20px;width:1920px;height:1080px"></div>'
  )
})

test('a sized template file is named by template, size and content', () => {
  const landscape = sizeTemplate(bodyOf('lower-third'), 1920, 1080)
  const name = templateFileName('lower-third', 1920, 1080, landscape)
  assert.match(name, /^lower-third-1920x1080-[0-9a-f]{8}\.html$/)
  // Same bytes, same file — placing a template twice reuses one asset.
  assert.equal(templateFileName('lower-third', 1920, 1080, landscape), name)
  // Different bytes, different file — a changed template never rewrites a placed clip's source.
  assert.notEqual(templateFileName('lower-third', 1920, 1080, `${landscape} `), name)
})
