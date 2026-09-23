import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogIndex, handlerIndex, type SourceFile } from './tool-registry'

const listing = (dir: string): SourceFile[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, source: readFileSync(join(dir, name), 'utf8') }))

const TARGETS = [
  { dir: 'src/shared/tools', file: 'index.ts', generate: catalogIndex },
  { dir: 'src/renderer/src/mcp', file: 'registry.ts', generate: handlerIndex }
]

for (const { dir, file, generate } of TARGETS) {
  test(`${dir}/${file} is what the files beside it generate`, () => {
    const onDisk = readFileSync(join(dir, file), 'utf8')
    assert.ok(
      generate(listing(dir)) === onDisk,
      `${dir}/${file} is stale — a tool or handler was added, removed or reordered without ` +
        'regenerating it. Run `pnpm gen:tools` and commit the result.'
    )
  })
}

test('the catalog index names every tool file, so the freshness check is not vacuous', () => {
  // If the generator matched no files, index.ts would be an empty list and still "fresh".
  const index = readFileSync('src/shared/tools/index.ts', 'utf8')
  const toolFiles = readdirSync('src/shared/tools').filter(
    (f) => f.endsWith('.ts') && !['index.ts', 'spec.ts', 'fields.ts'].includes(f)
  )
  assert.ok(toolFiles.length >= 30, `only ${toolFiles.length} tool files`)
  for (const f of toolFiles) assert.ok(index.includes(`from './${f.replace(/\.ts$/, '')}'`), `${f} is not in the index`)
})

const tool = (name: string, order: number | null): string =>
  (order === null ? '' : `export const order = ${order}\n\n`) +
  `export const tool: ToolSpec = {\n  name: '${name}',\n  description: 'x'\n}\n`

test('the catalog is listed by `order`, ties broken by file name, whatever the listing order', () => {
  const files: SourceFile[] = [
    { name: 'zeta.ts', source: tool('zeta', 10) },
    { name: 'beta.ts', source: tool('beta', 30) },
    { name: 'alpha.ts', source: tool('alpha', 30) },
    { name: 'fields.ts', source: 'export const frames = 1' },
    { name: 'spec.ts', source: 'export interface ToolSpec {}' }
  ]
  const index = catalogIndex(files)
  const list = index.slice(index.indexOf('TOOLS'))
  assert.ok(list.indexOf('zeta') < list.indexOf('alpha') && list.indexOf('alpha') < list.indexOf('beta'), list)
  assert.equal(catalogIndex([...files].reverse()), index)
  assert.doesNotMatch(index, /tool as (fields|spec)\b/, 'helpers are not tools')
})

test('a tool file the generator cannot place is refused by name, not skipped', () => {
  // Skipping it would drop a tool from the catalog while every test of the rest passed.
  assert.throws(() => catalogIndex([{ name: 'new-tool.ts', source: tool('new_tool', null) }]), /new-tool\.ts has no `export const order/)
  assert.throws(
    () => catalogIndex([{ name: 'new-tool.ts', source: 'export const order = 5\nexport const spec = {}' }]),
    /new-tool\.ts has no `export const tool/
  )
  assert.throws(
    () => catalogIndex([{ name: 'a.ts', source: tool('same', 1) }, { name: 'b.ts', source: tool('same', 2) }]),
    /a\.ts and b\.ts both define the tool 'same'/
  )
  // The positive control: the same files, well-formed, generate.
  assert.doesNotThrow(() => catalogIndex([{ name: 'a.ts', source: tool('one', 1) }, { name: 'b.ts', source: tool('two', 2) }]))
})

test('only modules that export handlers are in the handler registry', () => {
  const index = handlerIndex([
    { name: 'write.ts', source: 'export const handlers: Handlers = {\n  undo: () => undo()\n}' },
    { name: 'helpers.ts', source: 'export function store() {}' },
    { name: 'write.test.ts', source: 'export const handlers: Handlers = {}' },
    { name: 'registry.ts', source: 'export const handlers: Handlers = {}' }
  ])
  assert.match(index, /import \{ handlers as writeHandlers \} from '\.\/write'/)
  assert.doesNotMatch(index, /handlers as (helpers|writeTest|registry)Handlers/)
})
