/**
 * `@./file.json` argument substitution.
 *
 * An agent handing over a 200-entry edit list should not pay for it twice — once writing it
 * into the tool call and once having it echoed back. Writing the list to a file and passing
 * `@./edits.json` costs a dozen tokens.
 *
 * **The whole safety of this is in which strings qualify.** A caption that reads `@someone`,
 * an email address, a handle, a path that merely contains an `@` — all must pass through
 * untouched, because substituting one would replace the user's visible text with the contents
 * of a file, or fail the call over something that was never meant as a reference. So the rule
 * is deliberately narrow and stated positively: `@` followed by `./`, `../`, or `/`. Nothing
 * else is a reference, however much it looks like one.
 *
 * The decision is separated from the reading so it can be tested exhaustively against the
 * strings that must *not* trigger it — which is the half that matters and the half a test
 * against a real file would never cover.
 */

/** True when the string is a file reference rather than text that happens to start with `@`. */
export function isFileReference(value: string): boolean {
  if (!value.startsWith('@')) return false
  const rest = value.slice(1)
  return rest.startsWith('./') || rest.startsWith('../') || rest.startsWith('/')
}

/** The path a reference points at. Callers resolve relative paths against their own base. */
export function referencePath(value: string): string {
  return value.slice(1)
}

export type ReadFile = (path: string) => Promise<string>

/**
 * Replaces every file reference in `args`, recursively, with the file's parsed contents.
 *
 * Parsed, not inserted as text: a reference is how a list or an object is passed, and handing
 * a tool the *string* `"[1,2,3]"` where it expected an array would fail schema validation with
 * an error that says nothing about the file. A file whose contents are not JSON is substituted
 * as a plain string, which is the right answer for a caption or a transcript.
 */
export async function substituteFileArgs(
  args: Record<string, unknown>,
  readFile: ReadFile
): Promise<Record<string, unknown>> {
  const substituted = await substituteValue(args, readFile)
  return substituted as Record<string, unknown>
}

async function substituteValue(value: unknown, readFile: ReadFile): Promise<unknown> {
  if (typeof value === 'string') {
    if (!isFileReference(value)) return value
    const path = referencePath(value)
    let contents: string
    try {
      contents = await readFile(path)
    } catch (error) {
      // Named as a recovery instruction, per the contract's second rule: the agent wrote the
      // file a moment ago and needs to know which path was actually looked for.
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Could not read "${path}", referenced as "${value}". ${reason} ` +
          `Paths are resolved from bay's working directory, so use an absolute path if unsure.`
      )
    }
    try {
      return JSON.parse(contents)
    } catch {
      // Not JSON, so it is text — a transcript, a caption, a script. That is a legitimate
      // thing to pass by reference and must not be an error.
      return contents
    }
  }

  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const entry of value) out.push(await substituteValue(entry, readFile))
    return out
  }

  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = await substituteValue(entry, readFile)
    }
    return out
  }

  return value
}

/** The first file reference anywhere in `value`, or null — for callers that may not use them. */
export function findFileReference(value: unknown): string | null {
  if (typeof value === 'string') return isFileReference(value) ? value : null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFileReference(entry)
      if (found) return found
    }
    return null
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) {
      const found = findFileReference(entry)
      if (found) return found
    }
  }
  return null
}
