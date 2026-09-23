// Writes the two generated tool registries: `src/shared/tools/index.ts` (the catalog) and
// `src/renderer/src/mcp/registry.ts` (the handlers). What they contain and why they are
// checked in is in `src/shared/tool-registry.ts`; `tool-registry.test.ts` fails when either
// is stale. Usage: `pnpm gen:tools`.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogIndex, handlerIndex } from '../src/shared/tool-registry.ts'

const read = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, source: readFileSync(join(dir, name), 'utf8') }))

const targets = [
  ['src/shared/tools', 'index.ts', catalogIndex],
  ['src/renderer/src/mcp', 'registry.ts', handlerIndex]
]
for (const [dir, file, generate] of targets) {
  const path = join(dir, file)
  const next = generate(read(dir))
  let current = null
  try {
    current = readFileSync(path, 'utf8')
  } catch {}
  if (current === next) {
    console.log(`${path}: up to date`)
  } else {
    writeFileSync(path, next)
    console.log(`${path}: written`)
  }
}
