import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { unresolvedImports } from './committed-imports'

const git = (args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const filesAt = (commit: string): string[] =>
  git(['ls-tree', '-r', '--name-only', commit, '--', 'src'])
    .split('\n')
    .filter(Boolean)

const readAt = (commit: string) => (path: string): string =>
  git(['show', `${commit}:${path}`])

test('every relative import in HEAD resolves to a file HEAD contains', () => {
  const faults = unresolvedImports(filesAt('HEAD'), readAt('HEAD'))
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

test('a multi-line import is not a blind spot', () => {
  const files = ['src/a.ts']
  const source = `import {\n  one,\n  two\n} from './missing'\n`
  const faults = unresolvedImports(files, () => source)
  assert.equal(faults.length, 1)
  assert.equal(faults[0]?.specifier, './missing')
})
