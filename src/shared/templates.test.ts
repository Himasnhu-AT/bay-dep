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
import { TEMPLATES, findTemplate, templateForUri, templateUri, TEMPLATE_URI_PREFIX } from './templates'

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

test('the catalog agrees with each file about the variables it declares', () => {
  // The listing is what an agent reads before deciding what it may set. A variable named here
  // and absent there is a call that silently changes nothing.
  for (const spec of TEMPLATES) {
    const { info } = readComposition(bodyOf(spec.id))
    assert.deepEqual(
      info?.variables.map((v) => ({ id: v.id, type: v.type })),
      spec.variables.map((v) => ({ id: v.id, type: v.type })),
      `${spec.id}: declared variables`
    )
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
