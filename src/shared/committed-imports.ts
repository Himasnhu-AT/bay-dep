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

/** Only relative specifiers are our problem — bare ones are the package manager's. */
const RELATIVE_IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"](\.[^'"]*)['"]/g

/** `import './side-effect'` and `import type ... from` both matter; so does `export * from`. */
const BARE_SIDE_EFFECT = /(?:^|\n)\s*import\s*['"](\.[^'"]*)['"]/g

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

function specifiersIn(source: string): string[] {
  const found = new Set<string>()
  for (const pattern of [RELATIVE_IMPORT, BARE_SIDE_EFFECT]) {
    pattern.lastIndex = 0
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
 */
export function unresolvedImports(
  files: string[],
  read: (path: string) => string
): UnresolvedImport[] {
  const present = new Set(files)
  const faults: UnresolvedImport[] = []

  for (const file of files) {
    if (!/\.tsx?$/.test(file)) continue
    const dir = file.split('/').slice(0, -1).join('/')

    for (const rawSpecifier of specifiersIn(read(file))) {
      // A bundler query suffix names how to load the file, not a different file. Vite's
      // `./x.md?raw` inlines x.md as a string; resolving the specifier verbatim looks for a
      // file called `x.md?raw`, finds nothing, and reports a healthy import as broken. The
      // gate exists to catch a missing file, and this is the opposite error.
      const specifier = rawSpecifier.split('?')[0] ?? rawSpecifier
      if (specifier.length === 0) continue
      const base = normalise(`${dir}/${specifier}`)
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
