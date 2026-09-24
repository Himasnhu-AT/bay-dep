import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The website's home page carries a re-creation of the editor (website/src/components/app/),
 * and says it is drawn from the app's own theme and that every tool in its log is one the app
 * has. Both are claims about this repository, so this suite holds them: a change to the app's
 * palette, or the removal or renaming of a tool the figure shows, fails here rather than leaving
 * the site describing an app that no longer exists. It also holds the figure to its own files:
 * every rendered frame and filmstrip the sequence names must be in website/public.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** `--color-<name>: <value>` pairs from the first block of a stylesheet that opens with `opener`. */
function colourTokens(css: string, opener: string): Map<string, string> {
  const start = css.indexOf(opener)
  assert.ok(start >= 0, `no ${opener} block`)
  const end = css.indexOf('\n}', start)
  const block = css.slice(start, end)
  const out = new Map<string, string>()
  for (const m of block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    out.set(m[1] as string, (m[2] as string).trim().toLowerCase())
  }
  return out
}

/** Every `text: "<tool>"` on a tool step in the website's sequence. */
function plateTools(source: string): string[] {
  const names: string[] = []
  for (const m of source.matchAll(/kind:\s*"tool",\s*text:\s*"([a-z_]+)"/g)) names.push(m[1] as string)
  return names
}

test('the plate palette is the app palette, token for token', () => {
  const app = colourTokens(read('src/renderer/src/styles.css'), '@theme static {')
  const site = colourTokens(read('website/src/app/globals.css'), '@theme {')
  const plate = [...site].filter(([name]) => name.startsWith('app-'))
  // A specimen that proves the parse found the plate at all: an empty list passes every loop.
  assert.ok(plate.length >= 15, `found only ${plate.length} app- tokens in the site`)
  for (const [name, value] of plate) {
    const own = name.slice('app-'.length)
    assert.ok(app.has(own), `the site's --color-${name} has no --color-${own} in the app's styles.css`)
    assert.equal(value, app.get(own), `--color-${name} is ${value}; the app's --color-${own} is ${app.get(own)}`)
  }
})

test('every tool the plate shows is one the app has', () => {
  const catalog = new Set<string>()
  const dir = join(ROOT, 'src/shared/tools')
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const m = readFileSync(join(dir, file), 'utf8').match(/name:\s*'([a-z_]+)'/)
    if (m) catalog.add(m[1] as string)
  }
  const shown = plateTools(read('website/src/lib/sequence.ts'))
  assert.ok(catalog.has('preview_frame') && catalog.size > 20, `catalog parse found ${catalog.size} tools`)
  assert.ok(shown.length >= 10, `found only ${shown.length} tool steps in the plate`)
  const missing = [...new Set(shown)].filter((t) => !catalog.has(t))
  assert.deepEqual(missing, [], `the plate shows tools the app does not have: ${missing.join(', ')}`)
})

test('every frame and filmstrip the plate names is in the site', () => {
  const seq = read('website/src/lib/sequence.ts')
  const stills = [...(seq.match(/export const STILLS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1])
  const strips = [...seq.matchAll(/strip: "([a-z0-9-]+)"/g)].map((m) => m[1])
  assert.ok(stills.length >= 5 && strips.length >= 4, `found ${stills.length} stills and ${strips.length} strips`)
  const missing = [
    ...stills.map((n) => `website/public/plate/still-${n}.avif`),
    ...strips.map((n) => `website/public/plate/strip-${n}.avif`),
  ].filter((f) => !existsSync(join(ROOT, f)))
  assert.deepEqual(missing, [], `the plate names files the site does not have: ${missing.join(', ')}`)
})

test('the parsers see a stale value and a stale tool name (specimens)', () => {
  const app = colourTokens('@theme static {\n  --color-accent: #d9773f;\n}\n', '@theme static {')
  const site = colourTokens('@theme {\n  --color-app-accent: #5b8cff;\n}\n', '@theme {')
  assert.notEqual(site.get('app-accent'), app.get('accent'))
  assert.deepEqual(plateTools('{ chapter: 0, kind: "tool", text: "add_shape" }'), ['add_shape'])
})
