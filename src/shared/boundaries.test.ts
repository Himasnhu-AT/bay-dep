import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  boundaryViolations,
  describeViolation,
  folderCycles,
  RULES,
  specifiers,
  type Rule
} from './boundaries'
import type { Aliases } from './committed-imports'

/**
 * The working tree, tracked and untracked alike: this gate is about what the code *is*, and a
 * new file that breaks a boundary breaks it before anyone commits it. (Whether it is committed
 * at all is `committed-imports.test.ts`'s question.)
 */
const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' })
const FILES = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src'])
  .split('\n')
  .filter(Boolean)
  .filter((f) => {
    try {
      readFileSync(f)
      return true
    } catch {
      return false // deleted in the working tree but still in the index
    }
  })
const read = (path: string): string => readFileSync(path, 'utf8')

/** From the tsconfigs, as `committed-imports.test.ts` reads them — not restated. */
const ALIASES: Aliases = {}
for (const config of ['tsconfig.node.json', 'tsconfig.web.json']) {
  const paths = JSON.parse(readFileSync(config, 'utf8')).compilerOptions?.paths ?? {}
  for (const [pattern, targets] of Object.entries(paths as Record<string, string[]>)) {
    const target = targets[0]
    if (pattern.endsWith('/*') && target?.endsWith('/*')) ALIASES[pattern.slice(0, -1)] = target.slice(0, -1)
  }
}

test('the gate is looking at the tree it claims to', () => {
  // A listing that came back empty, or aliases that parsed to nothing, would make every test
  // below pass by examining nothing — the `src/main/**` glob, one level down.
  assert.ok(FILES.length > 200, `only ${FILES.length} files listed under src/`)
  assert.deepEqual(ALIASES, { '@shared/': 'src/shared/', '@/': 'src/renderer/src/' })
  for (const rule of RULES) {
    const governed = FILES.filter((f) => rule.scope.some((s) => f.startsWith(s)))
    assert.ok(governed.length > 0, `rule for ${rule.scope.join(', ')} governs no file`)
  }
})

test('no file reaches across a boundary', () => {
  const violations = boundaryViolations(FILES, read, ALIASES)
  assert.deepEqual(violations.map(describeViolation), [])
})

test('the folders of main import each other in one direction only', () => {
  assert.deepEqual(folderCycles(FILES, read, ALIASES, 'src/main/'), [])
})

test('the folders of the renderer import each other in one direction only', () => {
  // `lib/` is a bag of unrelated hooks and helpers — `useEngine` binds the engine to the
  // store, `bridge` is below the engine — so each of its files stands alone.
  assert.deepEqual(
    folderCycles(FILES, read, ALIASES, 'src/renderer/src/', ['src/renderer/src/lib/']),
    []
  )
})

// ---------------------------------------------------------------------------------------------
// The proofs. Each rule is shown to fire on a specimen that breaks it, and to stay quiet on the
// nearest legal specimen — a gate that refuses everything and a gate that works produce the
// same output on the first half alone.

const ENGINE_RULE = RULES.find((r) => r.scope.includes('src/renderer/src/engine/'))!

test('a transitive route into the store is caught, and the route is named', () => {
  // The shape that was actually in the tree: engine → lib helper → store.
  const files = [
    'src/renderer/src/engine/compositionPool.ts',
    'src/renderer/src/lib/bay.ts',
    'src/renderer/src/store/editor.ts'
  ]
  const sources: Record<string, string> = {
    'src/renderer/src/engine/compositionPool.ts': `import { bay } from '@/lib/bay'`,
    'src/renderer/src/lib/bay.ts': `import { useEditor } from '@/store/editor'`,
    'src/renderer/src/store/editor.ts': `import { create } from 'zustand'`
  }
  const violations = boundaryViolations(files, (p) => sources[p] ?? '', ALIASES, [ENGINE_RULE])

  assert.equal(violations.length, 1)
  const message = describeViolation(violations[0]!)
  // The error has to say how to fix it: the whole route, and where the code belongs.
  assert.match(message, /engine\/compositionPool\.ts → src\/renderer\/src\/lib\/bay\.ts → src\/renderer\/src\/store\/editor\.ts/)
  assert.match(message, /@\/lib\/useEngine/)
})

test('the same engine file reaching only the bridge is legal', () => {
  const files = [
    'src/renderer/src/engine/compositionPool.ts',
    'src/renderer/src/lib/bridge.ts',
    'src/shared/ipc.ts'
  ]
  const sources: Record<string, string> = {
    'src/renderer/src/engine/compositionPool.ts': `import { bay } from '@/lib/bridge'`,
    'src/renderer/src/lib/bridge.ts': `import type { BayApi } from '@shared/ipc'`
  }
  assert.deepEqual(boundaryViolations(files, (p) => sources[p] ?? '', ALIASES, [ENGINE_RULE]), [])
})

test('a builtin package is caught by prefix, and a lookalike name is not', () => {
  const rule: Rule = { scope: ['src/shared/'], mustNotReach: { packages: ['node:', 'react'] }, why: '' }
  const bad = boundaryViolations(['src/shared/a.ts'], () => `import { readFile } from 'node:fs/promises'`, ALIASES, [rule])
  assert.equal(bad[0]?.reached, 'node:fs/promises')

  // `react-markdown` is not `react`; `react/jsx-runtime` is.
  const lookalike = boundaryViolations(['src/shared/a.ts'], () => `import M from 'react-markdown'`, ALIASES, [rule])
  assert.deepEqual(lookalike, [])
  const subpath = boundaryViolations(['src/shared/a.ts'], () => `import { jsx } from 'react/jsx-runtime'`, ALIASES, [rule])
  assert.equal(subpath[0]?.reached, 'react/jsx-runtime')
})

test('tests are exempt, and only tests', () => {
  const rule: Rule = { scope: ['src/shared/'], mustNotReach: { packages: ['node:'] }, why: '' }
  const source = `import { test } from 'node:test'`
  assert.deepEqual(boundaryViolations(['src/shared/a.test.ts'], () => source, ALIASES, [rule]), [])
  assert.equal(boundaryViolations(['src/shared/a.ts'], () => source, ALIASES, [rule]).length, 1)
})

test('a folder cycle is caught; a one-way edge and a loose file are not cycles', () => {
  const files = ['src/main/html/templates.ts', 'src/main/mcp/resources.ts', 'src/main/mcp/server.ts', 'src/main/html/compositions.ts']
  const cyclic: Record<string, string> = {
    'src/main/html/templates.ts': `import { resourceBody } from '../mcp/resources'`,
    'src/main/mcp/server.ts': `import { isCompositionWindow } from '../html/compositions'`
  }
  assert.deepEqual(folderCycles(files, (p) => cyclic[p] ?? '', ALIASES, 'src/main/'), [
    ['src/main/html/', 'src/main/mcp/']
  ])

  const oneWay = { ...cyclic, 'src/main/html/templates.ts': '' }
  assert.deepEqual(folderCycles(files, (p) => oneWay[p] ?? '', ALIASES, 'src/main/'), [])

  // lib/a → engine and engine → lib/b is no cycle when lib's files stand alone, and one when not.
  const libFiles = ['src/r/lib/a.ts', 'src/r/lib/b.ts', 'src/r/engine/e.ts']
  const lib: Record<string, string> = {
    'src/r/lib/a.ts': `import { e } from '../engine/e'`,
    'src/r/engine/e.ts': `import { b } from '../lib/b'`
  }
  assert.deepEqual(folderCycles(libFiles, (p) => lib[p] ?? '', {}, 'src/r/', ['src/r/lib/']), [])
  assert.equal(folderCycles(libFiles, (p) => lib[p] ?? '', {}, 'src/r/').length, 1)
})

test('every import shape in the tree is read, and prose is not', () => {
  const source = [
    `import type { A } from './a'`,
    `import {`,
    `  b,`,
    `  c`,
    `} from '@/b'`,
    `export * from './c'`,
    `import './d.css'`,
    `const sdk = await import('@anthropic-ai/claude-agent-sdk')`,
    `const text = "a sentence that says import this from 'nowhere' mid-line"`
  ].join('\n')
  assert.deepEqual(specifiers(source).sort(), [
    './a',
    './c',
    './d.css',
    '@/b',
    '@anthropic-ai/claude-agent-sdk'
  ])
})
