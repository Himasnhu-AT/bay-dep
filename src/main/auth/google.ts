/**
 * Every network call bay makes about access — and the only ones main makes to Google.
 *
 * Electron-free: `fetch` is injected, so the tests hand in a fake and read exactly what would
 * have been sent. The injected fetch is also wrapped in `guardedFetch`, which refuses any host
 * outside `ACCESS_HOSTS` — this module cannot be pointed anywhere else by a bad string.
 *
 * What is sent: a refresh token (to securetoken), an ID token as a bearer (to Firestore), and the
 * email addresses that key the access documents. Never project data, media, paths or anything
 * about what the user does in bay.
 */

import { ACCESS_HOSTS, FIREBASE, normaliseEmail } from '@shared/access'
import { REVOKED_CODES, type VerifyOutcome } from './policy'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export function guardedFetch(inner: Fetch): Fetch {
  return (url, init) => {
    let host: string
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new Error('not https')
      host = parsed.hostname
    } catch {
      return Promise.reject(new Error(`bay's access check refused a malformed URL.`))
    }
    if (!(ACCESS_HOSTS as readonly string[]).includes(host)) {
      return Promise.reject(new Error(`bay's access check refused to contact ${host}: only ${ACCESS_HOSTS.join(' and ')}.`))
    }
    return inner(url, init)
  }
}

const DOCUMENTS = `projects/${FIREBASE.projectId}/databases/(default)/documents`
const FIRESTORE = `https://firestore.googleapis.com/v1/${DOCUMENTS}`

// -- tokens -------------------------------------------------------------------------------

export interface IdClaims {
  uid: string
  email: string | null
  emailVerified: boolean
}

/**
 * The claims in an ID token, read without checking the signature. That is deliberate and safe
 * here: the claims only choose *which* document to ask for. Firestore checks the signature on
 * every request, and its rules decide entitlement — a forged token gets nothing back.
 */
export function readClaims(idToken: string): IdClaims | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const uid = typeof claims['user_id'] === 'string' ? claims['user_id'] : typeof claims['sub'] === 'string' ? claims['sub'] : null
    if (!uid) return null
    return {
      uid,
      email: typeof claims['email'] === 'string' ? normaliseEmail(claims['email']) : null,
      emailVerified: claims['email_verified'] === true
    }
  } catch {
    return null
  }
}

export type RefreshOutcome =
  | { kind: 'ok'; idToken: string; refreshToken: string; claims: IdClaims }
  | Extract<VerifyOutcome, { kind: 'revoked' | 'network' | 'error' }>

/** Exchanges a refresh token for a fresh ID token at securetoken. */
export async function refreshIdToken(fetcher: Fetch, refreshToken: string): Promise<RefreshOutcome> {
  let response: Response
  try {
    response = await guardedFetch(fetcher)(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString()
    })
  } catch (error) {
    return { kind: 'network', message: error instanceof Error ? error.message : String(error) }
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (response.ok && body && typeof body['id_token'] === 'string') {
    const claims = readClaims(body['id_token'])
    if (!claims) return { kind: 'error', message: 'Google returned an ID token bay could not read.' }
    return {
      kind: 'ok',
      idToken: body['id_token'],
      refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : refreshToken,
      claims
    }
  }
  if (response.status >= 500 || response.status === 429) {
    return { kind: 'network', message: `Google's token service answered ${response.status}.` }
  }
  const code = errorCode(body)
  // The message can carry detail after the code ("TOKEN_EXPIRED : …"); match on the code.
  const revoked = REVOKED_CODES.find((known) => code.startsWith(known))
  if (response.status === 400 && revoked) return { kind: 'revoked', code: revoked }
  return { kind: 'error', message: `Google refused the sign-in (${response.status} ${code || 'no code'}).` }
}

function errorCode(body: Record<string, unknown> | null): string {
  const error = body?.['error'] as Record<string, unknown> | undefined
  const message = error?.['message'] ?? error?.['status']
  return typeof message === 'string' ? message : ''
}

// -- Firestore --------------------------------------------------------------------------

type GetOutcome =
  | { kind: 'found'; fields: Record<string, unknown> }
  | { kind: 'missing' }
  | { kind: 'denied' }
  | { kind: 'network'; message: string }
  | { kind: 'error'; message: string }

async function getDocument(fetcher: Fetch, idToken: string, path: string): Promise<GetOutcome> {
  let response: Response
  try {
    response = await guardedFetch(fetcher)(`${FIRESTORE}/${path}`, {
      headers: { Authorization: `Bearer ${idToken}` }
    })
  } catch (error) {
    return { kind: 'network', message: error instanceof Error ? error.message : String(error) }
  }
  if (response.status === 200) {
    const body = (await response.json().catch(() => null)) as { fields?: Record<string, unknown> } | null
    return { kind: 'found', fields: body?.fields ?? {} }
  }
  if (response.status === 404) return { kind: 'missing' }
  if (response.status === 403) return { kind: 'denied' }
  if (response.status >= 500 || response.status === 429) {
    return { kind: 'network', message: `Firestore answered ${response.status}.` }
  }
  return { kind: 'error', message: `Firestore answered ${response.status}.` }
}

function docPath(collection: 'access' | 'users', id: string): string {
  return `${collection}/${encodeURIComponent(id)}`
}

function intField(fields: Record<string, unknown>, name: string): number | null {
  const value = fields[name] as { integerValue?: string } | undefined
  const n = Number(value?.integerValue)
  return value?.integerValue !== undefined && Number.isFinite(n) ? n : null
}

/**
 * One full verification: refresh the token, then read `access/{email}` with the new ID token.
 *
 * Entitlement is the contract's: the grant exists AND the email is verified. The refreshed
 * refresh token is returned so the caller can store it (Google may rotate it).
 */
export async function verifyAccess(
  fetcher: Fetch,
  refreshToken: string
): Promise<{ outcome: VerifyOutcome; refreshToken: string | null; idToken: string | null }> {
  const refreshed = await refreshIdToken(fetcher, refreshToken)
  if (refreshed.kind !== 'ok') return { outcome: refreshed, refreshToken: null, idToken: null }
  const { claims, idToken } = refreshed
  const keep = { refreshToken: refreshed.refreshToken, idToken }
  if (!claims.email) {
    return { outcome: { kind: 'error', message: 'This account has no email address, and bay grants access by email.' }, ...keep }
  }
  if (!claims.emailVerified) {
    return { outcome: { kind: 'unverified-email', email: claims.email, uid: claims.uid }, ...keep }
  }
  const grant = await getDocument(fetcher, idToken, docPath('access', claims.email))
  switch (grant.kind) {
    case 'missing':
    case 'denied':
      // 404 is "no grant". 403 is the rules refusing the grantee their own doc, which the contract
      // allows only when the grant exists and the email is verified — so it is "no grant" as well.
      return { outcome: { kind: 'no-grant', email: claims.email, uid: claims.uid }, ...keep }
    case 'network':
    case 'error':
      return { outcome: grant, ...keep }
    case 'found': {
      const user = await getDocument(fetcher, idToken, docPath('users', claims.uid))
      const referralsUsed = user.kind === 'found' ? (intField(user.fields, 'referralsUsed') ?? 0) : user.kind === 'missing' ? 0 : null
      return { outcome: { kind: 'granted', email: claims.email, uid: claims.uid, referralsUsed }, ...keep }
    }
  }
}

// -- referrals --------------------------------------------------------------------------

/**
 * The contract's two-write batch, as the body of `documents:commit`: create `access/{friend}`
 * (via 'referral', granted by this uid, `grantedAt` = request time) only if it does not exist,
 * and add exactly 1 to `users/{uid}.referralsUsed` (setting `lastReferral` to the friend) only
 * if that doc exists. Firestore applies
 * both or neither; the rules check the pair with `getAfter`.
 */
export function referralCommitBody(input: { friendEmail: string; referrerEmail: string; uid: string }): unknown {
  const friend = normaliseEmail(input.friendEmail)
  return {
    writes: [
      {
        update: {
          name: `${DOCUMENTS}/access/${friend}`,
          fields: {
            email: { stringValue: friend },
            via: { stringValue: 'referral' },
            grantedBy: { stringValue: input.uid },
            referrerEmail: { stringValue: normaliseEmail(input.referrerEmail) }
          }
        },
        updateTransforms: [{ fieldPath: 'grantedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false }
      },
      {
        // `lastReferral` names the grant this +1 pays for: the rules check
        // `getAfter(users/uid).lastReferral == the grant's id`, so one increment cannot pay for
        // several grants in one batch (the backend's change to the contract, measured there).
        update: {
          name: `${DOCUMENTS}/users/${input.uid}`,
          fields: { lastReferral: { stringValue: friend } }
        },
        updateMask: { fieldPaths: ['lastReferral'] },
        updateTransforms: [{ fieldPath: 'referralsUsed', increment: { integerValue: '1' } }],
        currentDocument: { exists: true }
      }
    ]
  }
}

/** `users/{uid}` with `referralsUsed: 0`, created by the user themself when it is missing. */
export function userCreateBody(input: { uid: string; email: string }): unknown {
  return {
    writes: [
      {
        update: {
          name: `${DOCUMENTS}/users/${input.uid}`,
          fields: { email: { stringValue: normaliseEmail(input.email) }, referralsUsed: { integerValue: '0' } }
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false }
      }
    ]
  }
}

export type CommitOutcome =
  | { kind: 'ok' }
  | { kind: 'exists' }
  | { kind: 'denied' }
  | { kind: 'network'; message: string }
  | { kind: 'error'; message: string }

export async function commit(fetcher: Fetch, idToken: string, body: unknown): Promise<CommitOutcome> {
  let response: Response
  try {
    response = await guardedFetch(fetcher)(`${FIRESTORE}:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (error) {
    return { kind: 'network', message: error instanceof Error ? error.message : String(error) }
  }
  if (response.ok) return { kind: 'ok' }
  const code = errorCode((await response.json().catch(() => null)) as Record<string, unknown> | null)
  if (response.status === 409 || /ALREADY_EXISTS/.test(code)) return { kind: 'exists' }
  if (response.status === 400 && /FAILED_PRECONDITION|already exists/i.test(code)) return { kind: 'exists' }
  if (response.status === 403) return { kind: 'denied' }
  if (response.status >= 500 || response.status === 429) return { kind: 'network', message: `Firestore answered ${response.status}.` }
  return { kind: 'error', message: `Firestore answered ${response.status}${code ? ` (${code})` : ''}.` }
}

/** Whether this account can read `access/{email}` — true only for a grant it made itself. */
export async function readGrant(fetcher: Fetch, idToken: string, email: string): Promise<'mine' | 'unreadable' | 'offline'> {
  const grant = await getDocument(fetcher, idToken, docPath('access', normaliseEmail(email)))
  if (grant.kind === 'found') return 'mine'
  if (grant.kind === 'network') return 'offline'
  return 'unreadable'
}

/** Reads `users/{uid}`: its `referralsUsed`, 'missing', or null when it could not be read. */
export async function readReferralsUsed(fetcher: Fetch, idToken: string, uid: string): Promise<number | 'missing' | null> {
  const user = await getDocument(fetcher, idToken, docPath('users', uid))
  if (user.kind === 'found') return intField(user.fields, 'referralsUsed') ?? 0
  if (user.kind === 'missing') return 'missing'
  return null
}
