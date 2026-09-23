/**
 * Which parts of the tree may know about which — checked, not remembered.
 *
 * The layering here was already mostly clean, and was kept that way by people reading
 * comments like "the only file in `engine/` that knows the store exists". Comments do not fail
 * a build. The engine reached the store anyway, transitively: `compositionPool.ts` imported
 * `lib/bay.ts` for the bridge accessor, and `lib/bay.ts` imports the store to raise toasts. No
 * single import looked wrong, which is why a rule over *direct* imports would have passed it —
 * so the rules here are over what a file can **reach**.
 *
 * This is the alternative to splitting the tree into workspace packages. A package boundary
 * would enforce the same edges, and would also put every cross-boundary import out of sight of
 * `committed-imports.ts`, the node:test resolver hook and the tsconfig includes. A test over
 * the import graph enforces the edges and changes nothing else.
 *
 * Pure over a file listing and a reader, like `committed-imports.ts`, so the test can prove
 * each rule against a specimen that breaks it.
 */

import type { Aliases } from './committed-imports'

/** What TypeScript tries for an extensionless specifier, in order. */
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx']

const PATTERNS = [
  // `import x from`, `import type {…} from`, `export * from`, multi-line braces included. The
  // `[^'"]*?` keeps one match from running across a string into an unrelated `from '…'`.
  /(?:^|\n)\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  // `import './side-effect.css'`.
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  // `await import('…')` — main loads the Agent SDK this way.
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
]

export function specifiers(source: string): string[] {
  const found = new Set<string>()
  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern)) if (match[1]) found.add(match[1])
  }
  return [...found]
}

function normalise(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/** An import, resolved: a file in the tree, or a bare package name such as `electron`. */
export type Target = { file: string } | { bare: string }

export function resolve(
  from: string,
  specifier: string,
  present: ReadonlySet<string>,
  aliases: Aliases
): Target | null {
  const path = specifier.split('?')[0] ?? specifier
  const alias = Object.keys(aliases).find((prefix) => path.startsWith(prefix))
  let base: string
  if (alias !== undefined) base = normalise(`${aliases[alias]}/${path.slice(alias.length)}`)
  else if (path.startsWith('.')) base = normalise(`${from.split('/').slice(0, -1).join('/')}/${path}`)
  else return { bare: path }
  for (const suffix of CANDIDATE_SUFFIXES) {
    if (present.has(base + suffix)) return { file: base + suffix }
  }
  // Unresolvable is `committed-imports.ts`'s finding to report, not this gate's.
  return null
}

export interface Rule {
  /** Files the rule governs: every path starting with one of these. */
  scope: string[]
  /** What they must not reach, directly or through anything they import. */
  mustNotReach: {
    /** Tree paths, by prefix. */
    paths?: string[]
    /** Package names, by prefix: `node:` covers every builtin. */
    packages?: string[]
  }
  /** The sentence a person reads when it fails: what the layer is for, and where the code goes. */
  why: string
}

const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file)

export const RULES: Rule[] = [
  {
    scope: ['src/shared/'],
    mustNotReach: {
      paths: ['src/main/', 'src/renderer/', 'src/preload/'],
      packages: ['electron', 'node:', 'react', 'zustand']
    },
    why:
      '`src/shared/` is the contract both processes compile, so it can depend on neither ' +
      'process, nor on a runtime only one of them has. Take the value as an argument, or ' +
      'move the code to the side that owns the dependency.'
  },
  {
    scope: ['src/renderer/'],
    mustNotReach: { paths: ['src/main/'], packages: ['electron', 'node:'] },
    why:
      'The renderer never touches the filesystem or Electron directly. Everything it needs ' +
      'from main arrives over `window.bay` (`src/shared/ipc.ts`) or the `bay://` protocol.'
  },
  {
    scope: ['src/main/'],
    mustNotReach: { paths: ['src/renderer/'] },
    why:
      'Main is a different process from the renderer; anything both need belongs in ' +
      '`src/shared/`.'
  },
  {
    scope: ['src/renderer/src/engine/'],
    mustNotReach: {
      paths: [
        'src/renderer/src/store/',
        'src/renderer/src/editor/',
        'src/renderer/src/components/',
        'src/renderer/src/mcp/'
      ],
      packages: ['react', 'zustand']
    },
    why:
      '`engine/` takes its inputs as arguments, which is what makes the clock, the compositor ' +
      'and the audio graph testable without a window. The one place it meets React and the ' +
      'store is `@/lib/useEngine`; the bridge alone is `@/lib/bridge`.'
  },
  {
    scope: ['src/renderer/src/components/'],
    mustNotReach: {
      paths: [
        'src/renderer/src/store/',
        'src/renderer/src/editor/',
        'src/renderer/src/mcp/',
        'src/renderer/src/engine/'
      ]
    },
    why:
      '`components/` is presentational: it renders its props. Read the store in the caller ' +
      'and pass the value in, as `Toast` takes `toast` and `onDismiss`.'
  }
]

export interface Violation {
  rule: Rule
  from: string
  /** What was reached: a tree path or a package name. */
  reached: string
  /** `from` first, the forbidden target last — the whole route, so the fix is findable. */
  via: string[]
}

export function describeViolation(v: Violation): string {
  return `${v.from} reaches ${v.reached} (${v.via.join(' → ')}). ${v.rule.why}`
}

/**
 * Every rule broken by any non-test file, with the shortest route to the forbidden target.
 * Tests are exempt: they are allowed to reach anything they are testing with.
 */
export function boundaryViolations(
  files: string[],
  read: (path: string) => string,
  aliases: Aliases,
  rules: Rule[] = RULES
): Violation[] {
  const present = new Set(files)
  const sources = files.filter((f) => /\.tsx?$/.test(f) && !isTest(f))
  const edges = new Map<string, Target[]>()
  for (const file of sources) {
    edges.set(
      file,
      specifiers(read(file))
        .map((s) => resolve(file, s, present, aliases))
        .filter((t): t is Target => t !== null)
    )
  }

  const violations: Violation[] = []
  for (const rule of rules) {
    const forbiddenPath = (p: string): boolean =>
      (rule.mustNotReach.paths ?? []).some((prefix) => p.startsWith(prefix))
    const forbiddenPackage = (name: string): boolean =>
      (rule.mustNotReach.packages ?? []).some((prefix) =>
        prefix.endsWith(':') ? name.startsWith(prefix) : name === prefix || name.startsWith(`${prefix}/`)
      )

    for (const start of sources.filter((f) => rule.scope.some((s) => f.startsWith(s)))) {
      // Breadth-first, so the route reported is the shortest one.
      const cameFrom = new Map<string, string | null>([[start, null]])
      const queue = [start]
      const route = (to: string, last: string): string[] => {
        const path = [last]
        for (let at: string | null = to; at !== null; at = cameFrom.get(at) ?? null) path.unshift(at)
        return path
      }
      let found: Violation | null = null
      while (queue.length > 0 && found === null) {
        const at = queue.shift()!
        for (const target of edges.get(at) ?? []) {
          if ('bare' in target) {
            if (forbiddenPackage(target.bare)) {
              found = { rule, from: start, reached: target.bare, via: route(at, target.bare) }
              break
            }
            continue
          }
          if (forbiddenPath(target.file)) {
            found = { rule, from: start, reached: target.file, via: route(at, target.file) }
            break
          }
          if (!cameFrom.has(target.file)) {
            cameFrom.set(target.file, at)
            queue.push(target.file)
          }
        }
      }
      if (found) violations.push(found)
    }
  }
  return violations
}

/**
 * Cycles between the folders of one directory.
 *
 * `src/main/html` importing `src/main/mcp` while `mcp` imported `html` meant neither could be
 * read, tested or moved on its own. Each immediate subfolder of `root` is one node; a file
 * directly in `root`, or in a folder named in `loose`, is a node of its own, because those are
 * grab-bags of unrelated helpers (`paths.ts`, `lib/useDrag.ts`) that a folder-level edge would
 * falsely merge.
 */
export function folderCycles(
  files: string[],
  read: (path: string) => string,
  aliases: Aliases,
  root: string,
  loose: string[] = []
): string[][] {
  const present = new Set(files)
  const nodeOf = (file: string): string | null => {
    if (!file.startsWith(root)) return null
    const rest = file.slice(root.length).split('/')
    if (rest.length === 1) return file
    const folder = `${root}${rest[0]}/`
    return loose.includes(folder) ? file : folder
  }

  const graph = new Map<string, Set<string>>()
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || isTest(file)) continue
    const from = nodeOf(file)
    if (from === null) continue
    for (const s of specifiers(read(file))) {
      const target = resolve(file, s, present, aliases)
      if (target === null || !('file' in target)) continue
      const to = nodeOf(target.file)
      if (to === null || to === from) continue
      if (!graph.has(from)) graph.set(from, new Set())
      graph.get(from)!.add(to)
    }
  }

  // Tarjan's strongly connected components: every component of more than one node is a cycle.
  let index = 0
  const indices = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const cycles: string[][] = []
  const visit = (node: string): void => {
    indices.set(node, index)
    low.set(node, index)
    index++
    stack.push(node)
    onStack.add(node)
    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next)
        low.set(node, Math.min(low.get(node)!, low.get(next)!))
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, indices.get(next)!))
      }
    }
    if (low.get(node) === indices.get(node)) {
      const component: string[] = []
      let member: string
      do {
        member = stack.pop()!
        onStack.delete(member)
        component.push(member)
      } while (member !== node)
      if (component.length > 1) cycles.push(component.sort())
    }
  }
  for (const node of graph.keys()) if (!indices.has(node)) visit(node)
  return cycles
}
