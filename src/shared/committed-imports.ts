/**
 * Does every relative import in committed source resolve to a committed file?
 *
 * This exists because a commit can typecheck, pass the whole suite, and still not build.
 * `3031fb4` committed `compositor.ts`, which imports `./looks`, and left `looks.ts`
 * untracked: a fresh checkout of that commit has an import with nothing behind it. Neither
 * gate could see it, and the reason is the same for both — `tsc` and `node --test` read the
 * *working tree*, where the file is present. Nothing in this repository looked at what was
 * actually committed, so nothing could notice the difference.
 *
 * The two habits that produce it pull in opposite directions, which is why a rule does not
 * fix it. `git add -A` sweeps in other agents' in-flight work, so this tree forbids it; an
 * explicit path list cannot name a file you did not know had been created. Both mistakes
 * have happened here, on the same day.
 *
 * Kept as a pure function over a file listing and a reader so the test can run it against
 * any commit — including the one that had the bug, which is how the guard was proven.
 */

/** The extensions a bare relative import may resolve to, in the order TypeScript tries. */
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx']

/**
 * Path aliases: a specifier prefix and the repo-relative directory it stands for, e.g.
 * `{ '@shared/': 'src/shared/' }`. An aliased import is ours exactly as a relative one is — it
 * names a file in this tree — and a gate that only walked relative specifiers could not see
 * ~400 `@shared/` and `@/` imports — most of what crosses a module boundary, and the ones a
 * half-committed change is most likely to break. The caller derives these from the tsconfig so
 * this module does not hold one more copy of the mapping.
 */
export type Aliases = Record<string, string>

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** Relative and aliased specifiers are our problem — bare ones are the package manager's. */
function patterns(aliases: Aliases): RegExp[] {
  const ours = ['\\.', ...Object.keys(aliases).map(escape)].join('|')
  const spec = `((?:${ours})[^'"]*)`
  return [
    // `import type ... from` matters, and so does `export * from`.
    new RegExp(`(?:^|\\n)\\s*(?:import|export)[\\s\\S]*?from\\s*['"]${spec}['"]`, 'g'),
    // `import './side-effect'`.
    new RegExp(`(?:^|\\n)\\s*import\\s*['"]${spec}['"]`, 'g')
  ]
}

export interface UnresolvedImport {
  /** The committed file containing the import. */
  from: string
  /** The specifier as written. */
  specifier: string
  /** Where it would have had to be, so the message says what to do about it. */
  triedPaths: string[]
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

function specifiersIn(source: string, aliases: Aliases): string[] {
  const found = new Set<string>()
  for (const pattern of patterns(aliases)) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1]
      if (specifier) found.add(specifier)
    }
  }
  return [...found]
}

/**
 * @param files every source path present in the commit, repo-relative
 * @param read the contents of one of those paths, at that commit
 * @param aliases specifier prefixes that name directories in this tree (see `Aliases`)
 */
export function unresolvedImports(
  files: string[],
  read: (path: string) => string,
  aliases: Aliases = {}
): UnresolvedImport[] {
  const present = new Set(files)
  const faults: UnresolvedImport[] = []

  for (const file of files) {
    if (!/\.tsx?$/.test(file)) continue
    const dir = file.split('/').slice(0, -1).join('/')

    for (const rawSpecifier of specifiersIn(read(file), aliases)) {
      // A bundler query suffix names how to load the file, not a different file. Vite's
      // `./x.md?raw` inlines x.md as a string; resolving the specifier verbatim looks for a
      // file called `x.md?raw`, finds nothing, and reports a healthy import as broken. The
      // gate exists to catch a missing file, and this is the opposite error.
      const specifier = rawSpecifier.split('?')[0] ?? rawSpecifier
      if (specifier.length === 0) continue
      const alias = Object.keys(aliases).find((prefix) => specifier.startsWith(prefix))
      const base = normalise(
        alias === undefined
          ? `${dir}/${specifier}`
          : `${aliases[alias]}/${specifier.slice(alias.length)}`
      )
      // An explicit extension is tried as written; `./looks` is tried five ways.
      const tried = /\.(tsx?|json|css|svg|png|md|txt|wasm|woff2?)$/.test(specifier)
        ? [base]
        : [base, ...CANDIDATE_SUFFIXES.map((suffix) => `${base}${suffix}`)]

      if (!tried.some((candidate) => present.has(candidate))) {
        // Reported as written, suffix included: the reader has to find this line in the file,
        // and a stripped specifier does not match what is on it.
        faults.push({ from: file, specifier: rawSpecifier, triedPaths: tried })
      }
    }
  }
  return faults
}
