/**
 * Who may use bay, as both processes see it.
 *
 * Signing in is mandatory, and it is the whole check: the desktop app works for any Google account
 * whose sign-in Google still honours and whose email is verified. There is no grant, no waitlist and
 * no referral. The owner revokes an account by disabling it in Firebase Auth, which makes the next
 * refresh answer `USER_DISABLED` (`revoked`). Main decides; the renderer only draws what main reports, and main refuses the editor's IPC and every
 * MCP tool call until the answer is `entitled` (`src/main/auth/`).
 *
 * **The sentences came first**, per CLAUDE.md, and the type is what they needed:
 *
 * - signed-out     "Sign in to use bay. Sign in with your Google account."
 * - waiting        "Finish signing in with your browser. This window updates by itself."
 *                  → needs the URL (to open it again) and when the wait gives up.
 * - checking       "Signed in as {email}. Checking your access…"  → needs the email.
 * - entitled       "Signed in as {email}. Access last verified {when}."
 *                  and, when the last check could not reach Google, "bay keeps working offline
 *                  until {lockAt}; connect to the internet before then."
 *                  → needs email, lastVerifiedAt, lockAt, whether the last attempt failed, and
 *                  whether the sign-in survives a quit (safeStorage) — "you will sign in again
 *                  after quitting" is a sentence the user must be able to read.
 * - no-access      "{email} is not verified …"  → email + the reason (only an unverified email
 *                  is refused; any verified account is entitled).
 * - locked-offline "bay could not verify your access for 14 days, so it is locked. Connect to the
 *                  internet and sign in again."  → email, lastVerifiedAt.
 * - revoked        "The sign-in for {email} was revoked or has expired. Sign in again." /
 *                  "This account has been disabled."  → email + Google's code.
 * - error          "Sign-in did not finish: {message}"  → message; the screen offers Try again.
 *
 * A dev build launched with `BAY_ACCESS=dev` is `entitled` with `bypass: true` — "Access check
 * skipped: BAY_ACCESS=dev in an unpackaged build." — so the probes can run; a packaged build never
 * honours it (`accessBypass` in `src/main/auth/build.ts`).
 */

/** Firebase web config — public by design; the key only names the project to securetoken. */
export const FIREBASE = {
  apiKey: 'AIzaSyCv5j0n_KWnizBrE0uD7f2I4HKKez5V4fk'
} as const

/** The only host main talks to for access. Nothing else in the access code may be fetched. */
export const ACCESS_HOSTS = ['securetoken.googleapis.com'] as const

export const SITE_ORIGIN = 'https://bay.himanshuat.com'
/** The website's dev server. Accepted and opened only by an unpackaged build. */
export const DEV_SITE_ORIGIN = 'http://localhost:3000'

/** Consecutive days without a successful verification after which bay locks. */
export const OFFLINE_GRACE_DAYS = 14
export const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000
/** How often a running bay re-verifies. */
export const REVERIFY_INTERVAL_MS = 6 * 60 * 60 * 1000
/** How long the browser handoff waits before giving up. */
export const HANDOFF_TIMEOUT_MS = 5 * 60 * 1000

export type AccessStatus =
  | { state: 'signed-out' }
  | { state: 'waiting'; url: string; expiresAt: number }
  | { state: 'checking'; email: string | null }
  | {
      state: 'entitled'
      email: string
      lastVerifiedAt: number
      /** When bay locks if it cannot verify again before then. */
      lockAt: number
      /** The most recent attempt could not reach Google; the last verification is honoured offline. */
      offline: boolean
      /** False when safeStorage was unavailable: the sign-in lives in memory until quit. */
      persisted: boolean
      /** `BAY_ACCESS=dev` in an unpackaged build: no account at all. */
      bypass: boolean
    }
  | { state: 'no-access'; email: string; reason: 'unverified-email' }
  | { state: 'locked-offline'; email: string; lastVerifiedAt: number }
  | { state: 'revoked'; email: string | null; code: string }
  | { state: 'error'; message: string }

export function isEntitled(status: AccessStatus): boolean {
  return status.state === 'entitled'
}

/** The email as bay keeps it: lowercased and trimmed. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

function day(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The headline and the line under it, for the gate screen and for every refusal. */
export function describeAccess(status: AccessStatus): { title: string; detail: string } {
  switch (status.state) {
    case 'signed-out':
      return {
        title: 'Sign in to use bay',
        detail: 'Sign in with your Google account.'
      }
    case 'waiting':
      return {
        title: 'Finish signing in with your browser',
        detail: 'This window updates by itself once you are signed in.'
      }
    case 'checking':
      return {
        title: 'Checking your access…',
        detail: status.email ? `Signed in as ${status.email}.` : 'Signed in.'
      }
    case 'entitled':
      if (status.bypass) {
        return {
          title: 'Access check skipped',
          detail: 'BAY_ACCESS=dev in an unpackaged build — no account is in use.'
        }
      }
      return {
        title: `Signed in as ${status.email}`,
        detail: status.offline
          ? `bay could not reach the access server, so it is working offline until ${day(status.lockAt)}. Connect to the internet before then.`
          : `Access last verified ${day(status.lastVerifiedAt)}.`
      }
    case 'no-access':
      return {
        title: `${status.email} is not verified`,
        detail: 'bay needs a verified email address. Sign in with a verified account, or verify this one and sign in again.'
      }
    case 'locked-offline':
      return {
        title: 'bay is locked',
        detail: `bay could not verify your access for ${OFFLINE_GRACE_DAYS} days (last verified ${day(status.lastVerifiedAt)}). Connect to the internet and sign in again.`
      }
    case 'revoked':
      return status.code === 'USER_DISABLED'
        ? { title: 'This account has been disabled', detail: 'Sign in with a different account.' }
        : {
            title: 'Your sign-in has expired',
            detail: `The sign-in${status.email ? ` for ${status.email}` : ''} was revoked or has expired. Sign in again.`
          }
    case 'error':
      return { title: 'Sign-in did not finish', detail: status.message }
  }
}

/**
 * What a refused tool call or IPC call says. It names the state and how to get out of it, because
 * the caller is often an agent on the socket that cannot see bay's window.
 */
export function lockedMessage(status: AccessStatus): string {
  const { title, detail } = describeAccess(status)
  return (
    `bay is locked: ${title}. ${detail} ` +
    'To unlock it, open the bay window and sign in, ' +
    'then retry this call. Nothing was changed.'
  )
}
