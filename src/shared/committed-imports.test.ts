import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { unresolvedImports, type Aliases } from './committed-imports'

const git = (args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const filesAt = (commit: string): string[] =>
  git(['ls-tree', '-r', '--name-only', commit, '--', 'src'])
    .split('\n')
    .filter(Boolean)

const readAt = (commit: string) => (path: string): string =>
  git(['show', `${commit}:${path}`])

/**
 * The aliases, read from the committed tsconfigs rather than restated here: the tsconfigs are
 * what the compiler resolves through, so a literal copy would be one more mapping to drift.
 * `"@shared/*": ["src/shared/*"]` becomes `'@shared/' -> 'src/shared/'`.
 */
const aliasesAt = (commit: string): Aliases => {
  const aliases: Aliases = {}
  for (const config of ['tsconfig.node.json', 'tsconfig.web.json']) {
    const paths = JSON.parse(git(['show', `${commit}:${config}`])).compilerOptions?.paths ?? {}
    for (const [pattern, targets] of Object.entries(paths as Record<string, string[]>)) {
      const target = targets[0]
      if (!pattern.endsWith('/*') || !target?.endsWith('/*')) continue
      // `./src/shared/*` (TypeScript 7, no `baseUrl`) and `src/shared/*` (older commits) are
      // the same directory.
      aliases[pattern.slice(0, -1)] = target.slice(0, -1).replace(/^\.\//, '')
    }
  }
  return aliases
}

test('the aliases come out of the tsconfigs, so the aliased half of the tree is walked', () => {
  // If this read nothing, every aliased import would go unchecked and the HEAD test below
  // would still pass. That is exactly the blindness the aliases were added to remove.
  assert.deepEqual(aliasesAt('HEAD'), { '@shared/': 'src/shared/', '@/': 'src/renderer/src/' })
})

test('every relative and aliased import in HEAD resolves to a file HEAD contains', () => {
  const faults = unresolvedImports(filesAt('HEAD'), readAt('HEAD'), aliasesAt('HEAD'))
  assert.deepEqual(
    faults,
    [],
    faults.length === 0
      ? ''
      : `HEAD does not build from a fresh checkout. ${faults
          .map((f) => `${f.from} imports '${f.specifier}' — tried ${f.triedPaths.join(', ')}`)
          .join('; ')}`
  )
})

/**
 * The proof, and the reason this test is trustworthy.
 *
 * A guard written from a bug's description tends to pass against the bug. This one is run
 * against the actual commit that had it — 3031fb4 committed `compositor.ts` importing
 * `./looks` and left `looks.ts` untracked — so the failure is observed, not assumed.
 *
 * Skipped rather than failed if that commit is not reachable (a shallow clone, or history
 * rewritten later), because then the proof is absent and the absence should say so, not
 * masquerade as a pass.
 */
test('the guard catches the commit it was written for', (t) => {
  const broken = '3031fb4'
  try {
    git(['cat-file', '-e', `${broken}^{commit}`])
  } catch {
    t.skip(`${broken} unreachable — the proof cannot run here`)
    return
  }

  const faults = unresolvedImports(filesAt(broken), readAt(broken))
  const looks = faults.filter((f) => f.specifier === './looks')

  assert.ok(
    looks.length > 0,
    `expected ${broken} to be caught importing './looks' with no such file committed; ` +
      `the guard reported ${faults.length} fault(s): ${JSON.stringify(faults)}`
  )
  assert.equal(looks[0]?.from, 'src/renderer/src/engine/compositor.ts')
})

/** The guard must not fire on the shapes it is surrounded by, or it will be switched off. */
test('resolves the import shapes this tree actually uses', () => {
  const files = [
    'src/a/index.ts',
    'src/a/sibling.ts',
    'src/a/nested/deep.tsx',
    'src/b/up.ts',
    'src/b/styles.css'
  ]
  const sources: Record<string, string> = {
    'src/a/index.ts': [
      `import { x } from './sibling'`,
      `import type { Y } from './nested/deep'`,
      `export * from './sibling'`,
      `import '../b/styles.css'`,
      `import { z } from '../b/up'`,
      `import { createRoot } from 'react-dom/client'`,
      `import type { Item } from '@shared/project'`
    ].join('\n'),
    'src/a/sibling.ts': `import { deep } from './nested/deep'`,
    'src/a/nested/deep.tsx': `import { up } from '../../b/up'`,
    'src/b/up.ts': `import { everything } from '../a'`,
    'src/b/styles.css': ''
  }

  assert.deepEqual(unresolvedImports(files, (p) => sources[p] ?? ''), [])
})

const ALIASES: Aliases = { '@shared/': 'src/shared/', '@/': 'src/renderer/src/' }

test('an aliased import resolves through its alias, barrels included', () => {
  const files = ['src/shared/project.ts', 'src/renderer/src/engine/index.ts', 'src/main/a.ts']
  const source = [
    `import type { Item } from '@shared/project'`,
    `import { engine } from '@/engine'`,
    `import { Inter } from '@fontsource-variable/inter'`
  ].join('\n')

  assert.deepEqual(unresolvedImports(files, () => source, ALIASES), [])
})

test('an aliased import of an uncommitted file is caught', () => {
  // The fault this extension exists for: `src/main/a.ts` imports `@shared/looks` and
  // `looks.ts` was never committed — 3031fb4's shape, one alias over. Without aliases the
  // gate does not look at the line at all, which is the before-state this proves is gone.
  const files = ['src/shared/project.ts', 'src/main/a.ts']
  const source = `import { project } from '@shared/project'\nimport { looks } from '@shared/looks'`

  assert.deepEqual(unresolvedImports(files, () => source), [], 'precondition: blind without aliases')
  const faults = unresolvedImports(files, () => source, ALIASES)
  assert.equal(faults.length, 2) // one per file that reads the source, both import it
  assert.ok(faults.every((f) => f.specifier === '@shared/looks'))
  assert.ok(faults[0]?.triedPaths.includes('src/shared/looks.ts'))
})

test('a bundler query suffix names how to load a file, not a different file', () => {
  // Vite's `?raw` inlines the file as a string. Resolving the specifier verbatim looks for a
  // file called `guide.md?raw`, finds nothing, and reports a working import as broken — which
  // it did, against eleven real documents, the first time this gate met one.
  const files = ['src/a.ts', 'src/docs/guide.md']
  const source = `import guide from './docs/guide.md?raw'`

  assert.deepEqual(unresolvedImports(files, () => source), [])
})

test('a query suffix does not excuse a genuinely missing file', () => {
  // The positive control: stripping the suffix must not turn the check off. A `?raw` import of
  // something that is not committed is exactly the fault this gate exists for.
  const faults = unresolvedImports(['src/a.ts'], () => `import x from './docs/gone.md?raw'`)

  assert.equal(faults.length, 1)
  assert.equal(faults[0]?.specifier, './docs/gone.md?raw')
})

test('a multi-line import is not a blind spot', () => {
  const files = ['src/a.ts']
  const source = `import {\n  one,\n  two\n} from './missing'\n`
  const faults = unresolvedImports(files, () => source)
  assert.equal(faults.length, 1)
  assert.equal(faults[0]?.specifier, './missing')
})

test('code that builds import statements as strings is not itself an import', () => {
  // `src/shared/tool-registry.ts` writes the tool indexes. The old pattern started at
  // `export const BANNER`, ran across lines into a string reading "from './helpers'", and
  // reported a missing file that nothing imports — HEAD failed on its first commit.
  const source = [
    `export const BANNER = '// generated'`,
    `const lines = [`,
    `  "import type { Handlers } from './helpers'",`,
    '  `import { tool as ${id} } from \'./${file}\'`',
    `]`
  ].join('\n')
  assert.deepEqual(unresolvedImports(['src/a.ts'], () => source), [])
  // The positive control: a real import in the same file is still read.
  const faults = unresolvedImports(['src/a.ts'], () => `${source}\nimport { gone } from './gone'`)
  assert.deepEqual(faults.map((f) => f.specifier), ['./gone'])
})
