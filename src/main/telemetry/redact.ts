/**
 * What a crash message or stack may say before it leaves the machine. Electron-free and pure: the
 * home folder is passed in, so `redact.test.ts` proves each rule on a specimen that would leak.
 *
 * Text is redacted **line by line**, each line cut to `MAX_LINE` first, and every pattern is
 * linear: an unbounded run starts only where the character before it could not have continued
 * it (a negative lookbehind of the run's own class), so no pattern rescans from every position.
 * The test holds each known pathological input under 50 ms.
 *
 * The rules, in the order they run on a line:
 * 1. **URLs** lose their user info, query string and fragment (`?<query>`); `bay://` URLs lose
 *    everything after the scheme — their path is a percent-encoded file path.
 * 2. **Percent-encoding** is decoded once (a malformed sequence is left as it is), and the URL
 *    rules run again on the result.
 * 3. **Emails** become `<email>`.
 * 4. **Tokens and keys** (`Bearer …`, `sk-…`, `AIza…`, `ya29.…`, `AMf-…`, any base64url run of 32
 *    or more) become `<secret>`.
 * 5. **The home folder** becomes `~`.
 * 6. **Absolute paths** (`~/…`, `/…`, or after `file://`), wherever they start, keep only their
 *    last part: every directory becomes `…`, whatever the folder names hold (spaces, `: `,
 *    brackets). The file name is kept for code (`index.js:12:3` is what a stack is for) and
 *    replaced by `<file>` with its extension for anything else, because a media or project
 *    file's name *is* an asset or project name.
 * 7. **Quoted text** (“…”, ‘…’, "…", '…') becomes `<text>` — an error bay or a library composed
 *    from the user's data names the asset or project in quotes. Not on a stack frame line
 *    (`at fn (file:line)`), whose function names are what a stack is for; and a quoted span that
 *    is only a redacted path keeps that path.
 */

/** Longest line redacted; the rest of a longer line is dropped before any pattern runs. */
export const MAX_LINE = 2000

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![A-Za-z0-9-])/g
/**
 * A URL, to the first space or quote/bracket. Nothing after `://` is required, so a match never
 * fails partway and nothing is rescanned; `urls` takes it apart in the replacement.
 */
const ANY_URL = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*):\/\/([^\s'"<>()]*)/g
const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g

const SECRETS: readonly [RegExp, string][] = [
  [/\bBearer\s+\S+/g, 'Bearer <secret>'],
  [/(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/g, '<secret>'],
  [/(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g, '<secret>'],
  [/(?<![A-Za-z0-9_.-])ya29\.\S+/g, '<secret>'],
  [/(?<![A-Za-z0-9_-])AMf-\S+/g, '<secret>'],
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}/g, '<secret>']
]

/** Names worth keeping in a stack: code and the app's own bundles, never the user's files. */
const CODE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'mts', 'cts', 'node', 'html', 'asar', 'dylib', 'so', 'wasm'])

/**
 * An absolute path. It starts with `~/` or `/` wherever the character before could not be part of
 * a word, a relative path or a URL (`1/2`, `a/b`, `./x`, `https://` do not start one), or right
 * after `file://`; a lone `/` followed by a space is not a path.
 *
 * The directories run to the **last** `/` on the line, whatever lies between — a folder may be
 * named `Acme: Merger (2024)`, and nothing short of that is safe. What follows the last `/` is the
 * name, up to what ends a name in a stack or a message (quote, bracket, `:`, `,`, `;`, `|`).
 */
const ABSOLUTE_PATH = /(?:(?<=file:\/\/)|(?<![A-Za-z0-9_.~/\\-]))(~\/|\/(?=[^\s/]))((?:[^/\n]*\/)*)([^/\n'"`“”‘’()<>[\]{}|;:,]*)/g
/** The last extension in a name, followed by a space or the end: where a name with spaces ends. */
const LAST_EXTENSION = /\.[A-Za-z0-9]{1,8}(?=\s|$)/g

/** A stack frame line: `    at fn (file:line:col)`. */
const FRAME_LINE = /^\s*at\s/

/**
 * A quoted span; unclosed, to the end of the line (a cut may have removed the close). A straight
 * `'` opens only where it cannot be an apostrophe, and inside one an apostrophe followed by a
 * letter (`Alice's`) does not close it.
 */
const QUOTED = /“[^”]*(?:”|$)|‘[^’]*(?:’|$)|"[^"]*(?:"|$)|(?<![\p{L}\p{N}])'(?:[^']|'(?=[\p{L}\p{N}]))*(?:'|$)/gu
/** A quoted span holding only a path this file already redacted: kept, as it says no more than that. */
const REDACTED_PATH = /^(?:file:\/\/)?(?:~\/|\/)(?:…\/)?[^\s'"“”‘’]*$/

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** At most `max` UTF-16 units, never ending inside a surrogate pair. */
export function cutCodePoints(text: string, max: number): string {
  if (text.length <= max) return text
  let end = Math.max(0, max)
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end)
}

/** Each run of `%xx` decoded once; a run that is not valid UTF-8 has only its ASCII bytes decoded. */
function decodePercent(text: string): string {
  return text.replace(PERCENT_RUN, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run.replace(/%([0-7][0-9A-Fa-f])/g, (_whole, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    }
  })
}

function fileName(name: string): string {
  if (name === '') return ''
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : ''
  // A code file's name has no spaces; a name with them that ends `.js` is a sentence, not a file.
  if (CODE_EXTENSIONS.has(extension.toLowerCase()) && !/\s/.test(name)) return name
  return /^[A-Za-z0-9]{1,8}$/.test(extension) ? `<file>.${extension}` : '<file>'
}

/** A path's name part split into the file name and the prose that ran on after it. */
function splitName(name: string): { file: string; rest: string } {
  let end = -1
  for (const match of name.matchAll(LAST_EXTENSION)) end = match.index + match[0].length
  if (end < 0) {
    const space = name.search(/\s/)
    end = space < 0 ? name.length : space
  }
  return { file: name.slice(0, end), rest: name.slice(end) }
}

/** Every URL without its user info, query and fragment; a `bay://` URL without anything. */
function urls(line: string): string {
  return line.replace(ANY_URL, (_whole, scheme: string, rest: string) => {
    if (scheme.toLowerCase() === 'bay') return 'bay://…'
    const query = rest.search(/[?#]/)
    let kept = query < 0 ? rest : `${rest.slice(0, query)}?<query>`
    const authorityEnd = kept.search(/[/?]/)
    const at = kept.lastIndexOf('@', authorityEnd < 0 ? kept.length : authorityEnd)
    if (at >= 0 && (authorityEnd < 0 || at < authorityEnd)) kept = `<user>${kept.slice(at)}`
    return `${scheme}://${kept}`
  })
}

/**
 * One line, redacted, without the length cap — exported so the test can hold the patterns
 * themselves linear on inputs far longer than `MAX_LINE`.
 */
export function redactLine(line: string, home: string): string {
  // Control characters (a decoded %0A among them) become spaces: every rule below reads one line.
  let out = urls(decodePercent(urls(line))).replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, ' ')
  out = out.replace(EMAIL, '<email>')
  for (const [pattern, replacement] of SECRETS) out = out.replace(pattern, replacement)
  const trimmedHome = home.replace(/\/+$/, '')
  if (trimmedHome.length > 1) out = out.replace(new RegExp(`${escapeRegExp(trimmedHome)}(?=$|[/\\s'"():,;|\`}\\]])`, 'g'), '~')
  out = out.replace(ABSOLUTE_PATH, (_whole, root: string, directories: string, name: string) => {
    const { file, rest } = splitName(name)
    return `${root}${directories === '' ? '' : '…/'}${fileName(file)}${rest}`
  })
  if (!FRAME_LINE.test(out)) {
    out = out.replace(QUOTED, (span) => {
      const close = /[”’"']$/.test(span) && span.length > 1 ? span.slice(-1) : ''
      const inner = span.slice(1, span.length - close.length)
      return inner !== '' && REDACTED_PATH.test(inner) ? span : '<text>'
    })
  }
  return out
}

export function redact(text: string, home: string): string {
  return text
    .split('\n')
    .map((line) => redactLine(cutCodePoints(line, MAX_LINE), home))
    .join('\n')
}

/**
 * Cut to `max`, then redacted, then cut again (a replacement can be longer than what it replaced).
 * The first cut is made at the last whitespace before `max` when there is one, so it does not
 * leave half an email or half a token that the patterns would no longer recognise; a path cut
 * anywhere still loses its directories, and an unclosed quote still hides what follows it.
 */
export function redactTo(text: string, home: string, max: number): string {
  let cut = text
  if (text.length > max) {
    cut = cutCodePoints(text, max)
    const space = cut.search(/\s\S*$/)
    if (space > 0) cut = cut.slice(0, space)
  }
  return cutCodePoints(redact(cut, home), max)
}
