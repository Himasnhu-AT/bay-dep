/**
 * What a crash message or stack may say before it leaves the machine. Electron-free and pure: the
 * home folder is passed in, so `redact.test.ts` proves each rule on a specimen that would leak.
 *
 * The rules, in the order they run:
 * 1. **Emails** become `<email>`.
 * 2. **`bay://` URLs** become `bay://…` — their path is a percent-encoded file path.
 * 3. **The home folder**, plain or percent-encoded, becomes `~`.
 * 4. **Absolute paths** (`~/…`, `/…`, or after `file://`) keep only their last part: every
 *    directory becomes `…`, so `~/Clients/Acme/cut.bay` is `~/…/<file>.bay`. The file name is kept
 *    for code (`index.js:12:3` is what a stack is for) and replaced by `<file>` with its extension
 *    for anything else, because a media or project file's name *is* an asset or project name.
 *
 * Free text that is not a path or an email (a project name quoted in an error message) cannot be
 * recognised here, which is why bay's crash reports carry only exception text and never a
 * message bay composed from the user's data.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const BAY_URL = /bay:\/\/[^\s'"()<>]*/g

/** Names worth keeping in a stack: code and the app's own bundles, never the user's files. */
const CODE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'mts', 'cts', 'node', 'html', 'asar', 'dylib', 'so', 'wasm'])

/**
 * An absolute path: `~/` or `/`, where it starts a token (start, space, quote, bracket, `=`, `,`)
 * or follows `file://`. Directory segments may hold spaces — a Mac's folders do — but not a
 * quote, bracket, colon or newline, which is what ends a path in a stack line or an error.
 * The last part is the file name: up to a delimiter, or a name with spaces ending in an extension.
 */
const ABSOLUTE_PATH = /(?<=^|[\s'"(\[<=,]|file:\/\/)(~\/|\/)((?:[^/\n'"()<>:\[\]]*\/)*)((?:[^/\n'"()<>:,;\[\]]*?\.[A-Za-z0-9]{1,8}(?=$|[\s'"()<>:,;\[\]]))|[^/\s'"()<>:,;\[\]]*)/gm

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function fileName(name: string): string {
  if (name === '') return ''
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : ''
  // A code file's name has no spaces; a name with them that ends `.js` is a sentence, not a file.
  if (CODE_EXTENSIONS.has(extension.toLowerCase()) && !/\s/.test(name)) return name
  return /^[A-Za-z0-9]{1,8}$/.test(extension) ? `<file>.${extension}` : '<file>'
}

export function redact(text: string, home: string): string {
  let out = text.replace(EMAIL, '<email>').replace(BAY_URL, 'bay://…')
  const trimmedHome = home.replace(/\/+$/, '')
  if (trimmedHome.length > 1) {
    for (const form of new Set([trimmedHome, encodeURIComponent(trimmedHome), encodeURI(trimmedHome)])) {
      out = out.replace(new RegExp(`${escapeRegExp(form)}(?=$|[/%\\s'"():,])`, 'g'), '~')
    }
    // `~%2Fa%2Fb` — a percent-encoded path below home: nothing of it is kept.
    out = out.replace(/~%2F[^\s'"()<>]*/gi, '~/…')
  }
  return out.replace(ABSOLUTE_PATH, (_whole, root: string, directories: string, name: string) =>
    `${root}${directories === '' ? '' : '…/'}${fileName(name)}`
  )
}

/** Redacted, then cut to `max` characters. Redaction first: a cut must not split a path it would have hidden. */
export function redactTo(text: string, home: string, max: number): string {
  const redacted = redact(text, home)
  return redacted.length <= max ? redacted : redacted.slice(0, max)
}
