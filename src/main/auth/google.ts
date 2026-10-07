/**
 * Every network call bay makes about access — and the only ones main makes to Google.
 *
 * Electron-free: `fetch` is injected, so the tests hand in a fake and read exactly what would
 * have been sent. The injected fetch is also wrapped in `guardedFetch`, which refuses any host
 * outside `ACCESS_HOSTS` — this module cannot be pointed anywhere else by a bad string.
 *
 * What is sent: a refresh token, to securetoken, and nothing else. Never project data, media, paths
 * or anything about what the user does in bay.
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
      return Promise.reject(new Error(`bay's access check refused to contact ${host}: only ${ACCESS_HOSTS.join(', ')}.`))
    }
    return inner(url, init)
  }
}

// -- tokens -------------------------------------------------------------------------------

export interface IdClaims {
  uid: string
  email: string | null
  emailVerified: boolean
}

/**
 * The claims in an ID token, read without checking the signature. That is safe here because the
 * token is only ever read straight out of securetoken's own HTTPS answer to a refresh bay sent:
 * nothing else can put a token in front of this function.
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

/**
 * One full verification: refresh the token and read the claims of the new ID token.
 *
 * Entitlement is a sign-in that Google still honours with a verified email — there is no grant to
 * look up and no waitlist. Revoking an account is disabling it in Firebase Auth, which makes the
 * refresh answer `USER_DISABLED` (`revoked`). The refreshed refresh token is returned so the caller
 * can store it (Google may rotate it).
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
    return { outcome: { kind: 'error', message: 'This account has no email address, and bay needs one to sign in.' }, ...keep }
  }
  if (!claims.emailVerified) {
    return { outcome: { kind: 'unverified-email', email: claims.email, uid: claims.uid }, ...keep }
  }
  return { outcome: { kind: 'granted', email: claims.email, uid: claims.uid }, ...keep }
}
