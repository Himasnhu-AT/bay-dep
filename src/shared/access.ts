/**
 * Who may use bay, as both processes see it.
 *
 * bay is invite-only: the desktop app works for an account that has a grant (`access/{email}` in
 * Firestore, made by the owner or by an approved user's referral), and for nobody else. Main
 * decides; the renderer only draws what main reports, and main refuses the editor's IPC and every
 * MCP tool call until the answer is `entitled` (`src/main/auth/`).
 *
 * **The sentences came first**, per CLAUDE.md, and the type is what they needed:
 *
 * - signed-out     "Sign in to use bay. bay is invite-only — use the account that was given access."
 * - waiting        "Finish signing in with your browser. This window updates by itself."
 *                  → needs the URL (to open it again) and when the wait gives up.
 * - checking       "Signed in as {email}. Checking your access…"  → needs the email.
 * - entitled       "Signed in as {email}. Access last verified {when}."
 *                  and, when the last check could not reach Google, "bay keeps working offline
 *                  until {lockAt}; connect to the internet before then."
 *                  → needs email, lastVerifiedAt, lockAt, whether the last attempt failed, and
 *                  whether the sign-in survives a quit (safeStorage) — "you will sign in again
 *                  after quitting" is a sentence the user must be able to read.
 * - no-access      "{email} does not have access to bay yet. Request access, or ask someone who
 *                  has it to refer you." / "{email} is not verified …"  → email + which reason.
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

/** Firebase web config — public by design; the security is Firestore's rules. */
export const FIREBASE = {
  apiKey: 'AIzaSyCv5j0n_KWnizBrE0uD7f2I4HKKez5V4fk',
  projectId: 'bay-editor-app'
} as const

/** The only hosts main talks to for access. Nothing else in the access code may be fetched. */
export const ACCESS_HOSTS = ['securetoken.googleapis.com', 'firestore.googleapis.com'] as const

export const SITE_ORIGIN = 'https://bay.everholt.com'
/** The website's dev server. Accepted and opened only by an unpackaged build. */
export const DEV_SITE_ORIGIN = 'http://localhost:3000'

/** Referrals an approved account may make, over its lifetime (`users/{uid}.referralsUsed ≤ 5`). */
export const REFERRAL_LIMIT = 5
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
      /** The most recent attempt could not reach Google; the grant is being honoured offline. */
      offline: boolean
      /** False when safeStorage was unavailable: the sign-in lives in memory until quit. */
      persisted: boolean
      /** `REFERRAL_LIMIT - referralsUsed`, or null when not read yet. */
      referralsLeft: number | null
      /** `BAY_ACCESS=dev` in an unpackaged build: no account at all. */
      bypass: boolean
    }
  | { state: 'no-access'; email: string; reason: 'no-grant' | 'unverified-email' }
  | { state: 'locked-offline'; email: string; lastVerifiedAt: number }
  | { state: 'revoked'; email: string | null; code: string }
  | { state: 'error'; message: string }

export function isEntitled(status: AccessStatus): boolean {
  return status.state === 'entitled'
}

/** Doc ids are the email, lowercased and trimmed — the contract's one normalisation. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Loose on purpose: Firebase decides what an email is; this only catches a typo'd field. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normaliseEmail(email))
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
        detail: 'bay is invite-only. Sign in with the account that was given access.'
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
      return status.reason === 'unverified-email'
        ? {
            title: `${status.email} is not verified`,
            detail: 'Access needs a verified email address. Sign in with a verified account, or verify this one and sign in again.'
          }
        : {
            title: `${status.email} does not have access to bay yet`,
            detail: 'bay is invite-only. Request access, or ask someone who has it to refer you.'
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
    'To unlock it, open the bay window and sign in with an account that has access (bay is invite-only), ' +
    'then retry this call. Nothing was changed.'
  )
}

// -- the IPC payloads -------------------------------------------------------------------

export type ReferralResult =
  | { ok: true; email: string; referralsLeft: number }
  | {
      ok: false
      reason: 'invalid-email' | 'self' | 'already-has-access' | 'quota-used' | 'not-approved' | 'offline' | 'failed'
      error: string
    }
