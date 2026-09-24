/**
 * In-app updates: the status main reports, and the decisions made about it.
 *
 * Main owns the updater (`src/main/update/updater.ts`: electron-updater against a generic feed,
 * `UPDATE_FEED` in `./update-feed`, unset until there is somewhere to publish).
 * The renderer only shows the status and asks. Everything that decides something is here and
 * pure, so it is unit-tested: whether a version is newer, what the release notes say as plain
 * text, the sentence a person reads, and what has to happen to the open project before bay may
 * restart into the new version.
 *
 * The sentences were written before the type (CLAUDE.md, "Write the sentence before the type"):
 *
 *   disabled     "Updates: releasing soon." (a packaged bay with no feed configured yet, `soon`)
 *                "Updates are off in this build." + why (a checkout, or a feed setting that is not usable)
 *   idle         "bay has not checked for updates yet."
 *   checking     "Checking for updates…"
 *   current      "bay 0.1.0 is the latest version." (+ when it was checked)
 *   available    "bay 0.1.1 is available. You have 0.1.0." (+ its notes, + Update)
 *   downloading  "Downloading bay 0.1.1: 42% (61 MB of 146 MB)."
 *   ready        "bay 0.1.1 is downloaded. Restart bay to finish updating." (+ Restart to update)
 *   error        says what failed (checking / downloading / installing), why, and offers Retry,
 *                which repeats that same step. That is why `during` is a field.
 */

export type UpdateStep = 'check' | 'download' | 'install'

export type UpdateStatus =
  | { state: 'disabled'; current: string; reason: string; soon: boolean }
  | { state: 'idle'; current: string; feed: string }
  | { state: 'checking'; current: string; feed: string }
  | { state: 'current'; current: string; feed: string; checkedAt: number }
  | { state: 'available'; current: string; feed: string; next: string; notes: string; releaseDate: string | null }
  | { state: 'downloading'; current: string; feed: string; next: string; notes: string; percent: number; transferred: number; total: number }
  | { state: 'ready'; current: string; feed: string; next: string; notes: string }
  | { state: 'error'; current: string; feed: string; during: UpdateStep; message: string; next: string | null; notes: string }

/** Launch, then every six hours. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// -- versions ---------------------------------------------------------------------------------

interface Semver {
  core: [number, number, number]
  pre: string[]
}

function parseSemver(version: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim())
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : []
  }
}

/**
 * Semver precedence: negative when `a` is older than `b`, positive when newer, 0 when equal.
 * Build metadata is ignored. A prerelease is older than its release (`1.0.0-beta < 1.0.0`), and
 * prerelease fields compare numerically when both are numbers (`beta.2 < beta.10`).
 * Null when either side is not a version, so a malformed feed never reads as an upgrade.
 */
export function compareVersions(a: string, b: string): number | null {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) {
    const d = x.core[i]! - y.core[i]!
    if (d !== 0) return Math.sign(d)
  }
  if (x.pre.length === 0 || y.pre.length === 0) return Math.sign(y.pre.length - x.pre.length)
  const n = Math.max(x.pre.length, y.pre.length)
  for (let i = 0; i < n; i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) {
      const d = Number(p) - Number(q)
      if (d !== 0) return Math.sign(d)
    } else if (pn !== qn) {
      return pn ? -1 : 1
    } else if (p !== q) {
      return p < q ? -1 : 1
    }
  }
  return 0
}

/** Whether `next` is strictly newer than `current`. False for anything unparseable. */
export function isNewer(next: string, current: string): boolean {
  return (compareVersions(next, current) ?? 0) > 0
}

// -- release notes ----------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** One note as plain text. Feeds often write notes as HTML (GitHub does). */
function plainText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      const lower = name.toLowerCase()
      if (ENTITIES[lower] !== undefined) return ENTITIES[lower]!
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
      if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)))
      return whole
    })
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The most text a banner shows. The rest is on the release page. */
export const NOTES_LIMIT = 1200

/**
 * electron-updater's `releaseNotes` as plain text. It is a string, or an array of
 * `{ version, note }` when there are several releases between here and the latest, or null.
 * The notes are rendered as text and never as HTML: they come off the network.
 */
export function releaseNotesText(notes: unknown): string {
  let text = ''
  if (typeof notes === 'string') text = plainText(notes)
  else if (Array.isArray(notes)) {
    text = notes
      .map((entry: unknown) => {
        const { version, note } = (entry ?? {}) as { version?: unknown; note?: unknown }
        const body = typeof note === 'string' ? plainText(note) : ''
        return typeof version === 'string' && body ? `${version}\n${body}` : body
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return text.length > NOTES_LIMIT ? `${text.slice(0, NOTES_LIMIT - 1).trimEnd()}…` : text
}

// -- sentences --------------------------------------------------------------------------------

function megabytes(bytes: number): string {
  return `${Math.max(0, Math.round(bytes / 1_000_000))} MB`
}

const STEP: Record<UpdateStep, string> = {
  check: 'check for updates',
  download: 'download the update',
  install: 'install the update'
}

/** The line a person reads for a status, and the one below it. */
export function describeUpdate(status: UpdateStatus): { title: string; detail: string } {
  switch (status.state) {
    case 'disabled':
      // The owner's wording for a packaged bay before there is a feed: not an error, no nagging.
      if (status.soon) return { title: 'Updates: releasing soon', detail: '' }
      return { title: 'Updates are off in this build.', detail: status.reason }
    case 'idle':
      return { title: 'bay has not checked for updates yet.', detail: `Updates come from ${status.feed}.` }
    case 'checking':
      return { title: 'Checking for updates…', detail: `Asking ${status.feed}.` }
    case 'current':
      return { title: `bay ${status.current} is the latest version.`, detail: `Checked ${status.feed}.` }
    case 'available':
      return { title: `bay ${status.next} is available.`, detail: `You have ${status.current}. Nothing downloads until you press Update.` }
    case 'downloading': {
      const size = status.total > 0 ? ` (${megabytes(status.transferred)} of ${megabytes(status.total)})` : ''
      return { title: `Downloading bay ${status.next}: ${Math.floor(status.percent)}%${size}.`, detail: 'You can keep working.' }
    }
    case 'ready':
      return { title: `bay ${status.next} is downloaded.`, detail: 'Restart bay to finish updating. Your project is saved first.' }
    case 'error':
      return { title: `bay could not ${STEP[status.during]}.`, detail: status.message }
  }
}

/**
 * What went wrong, as a sentence someone can act on. electron-updater's own messages are stack-
 * shaped ("HttpError: 404 … Headers: {…}") and name no remedy.
 */
export function updateErrorMessage(raw: string, during: UpdateStep, feed: string): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (/refused to contact|not an update host/i.test(text)) return text.replace(/^Error: /, '')
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ENETUNREACH|ERR_NETWORK_CHANGED|ECONNREFUSED|ERR_CONNECTION/i.test(text)) {
    return `bay could not reach ${feed}. Check the connection and retry.`
  }
  if (/\b404\b|Cannot find (latest|channel)|No published versions/i.test(text)) {
    return `${feed} has no release for this Mac yet. Retry later.`
  }
  if (/sha512 checksum mismatch|checksum/i.test(text)) {
    return 'The download did not match its checksum, so bay discarded it. Retry to download it again.'
  }
  if (/code signature|designated requirement|did not pass validation|not signed/i.test(text)) {
    return 'macOS refused the update because it is not signed by the same developer as this bay. It was not installed.'
  }
  if (/read-only|EROFS|Applications folder|translocat/i.test(text)) {
    return 'bay cannot replace itself where it is running from. Move bay to the Applications folder, open it from there, and retry.'
  }
  const first = text.replace(/^Error: /, '').split(/(?<=\.)\s|\s(?:Headers|at )\b/)[0] ?? text
  return `${first.slice(0, 200)}${first.length > 200 ? '…' : ''} Retry to ${STEP[during]} again.`
}

// -- the banner -------------------------------------------------------------------------------

/** Whether the banner asks for attention. It stays quiet when there is nothing to act on. */
export function bannerVisible(status: UpdateStatus | null, dismissedVersion: string | null): boolean {
  if (!status) return false
  switch (status.state) {
    case 'available':
      return status.next !== dismissedVersion
    case 'downloading':
    case 'ready':
      return true
    case 'error':
      // A failed background check is not worth interrupting anyone for. The user sees it in
      // Settings. A failure after they pressed Update or Restart is shown.
      return status.during !== 'check'
    default:
      return false
  }
}

// -- restarting into the update ---------------------------------------------------------------

export type RestartPlan =
  /** Nothing unsaved: restart now. */
  | { kind: 'install' }
  /** Unsaved changes, and saving is allowed: ask, save, and only then restart. */
  | { kind: 'save-first'; project: string }
  /**
   * Unsaved changes while bay is locked. Saving the project file is refused while locked, but the
   * autosave sidecar is not (`OPEN_WHILE_LOCKED`). The sidecar is written, and restart only once it is.
   */
  | { kind: 'autosave-first' }

export function restartPlan(state: { screen: 'home' | 'editor'; dirty: boolean; locked: boolean; projectName: string }): RestartPlan {
  if (state.screen !== 'editor' || !state.dirty) return { kind: 'install' }
  if (state.locked) return { kind: 'autosave-first' }
  return { kind: 'save-first', project: state.projectName }
}

/**
 * Runs a plan: every step that protects work comes before `install`, and `install` runs only if
 * those steps succeeded. `save` resolves false when the user cancels its dialog or it fails.
 * Resolves with what happened, for the UI to say.
 */
export async function runRestart(
  plan: RestartPlan,
  steps: { save: () => Promise<boolean>; autosave: () => Promise<boolean>; install: () => Promise<void> }
): Promise<'installing' | 'not-saved'> {
  if (plan.kind === 'save-first' && !(await steps.save())) return 'not-saved'
  if (plan.kind === 'autosave-first' && !(await steps.autosave())) return 'not-saved'
  await steps.install()
  return 'installing'
}
