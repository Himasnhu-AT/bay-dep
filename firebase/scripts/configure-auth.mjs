// Configure Firebase Auth for bay-editor-app: Google is the only way in. The
// Email/Password provider (and with it the email link) is switched off, the
// authorised domains bay signs in from are added, and the result is read back:
// it exits non-zero unless email sign-in is off and Google is on.
//
// Why off rather than unused: the website no longer sends sign-in links, and an
// enabled provider still answers anyone who calls the Identity Toolkit API
// directly with the public API key, sending mail in the project's name.
//
// The firebase CLI has no command for this, so it calls the Identity Toolkit
// Admin API with the CLI's own logged-in credentials (its configstore). The
// token is read from disk and sent in a header; it is never printed or written.
//
// Preconditions (see README.md):
//   - `firebase login` as a project owner, and any recent firebase command, so
//     the cached access token is fresh (this script does not refresh it).
//   - Authentication initialised once in the console ("Get started"). On the
//     Spark plan the API cannot do that step: initializeAuth answers
//     BILLING_NOT_ENABLED, and the config reads CONFIGURATION_NOT_FOUND until then.
//
// Run: pnpm auth:configure        (add --dry-run to only read)

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECT = 'bay-editor-app'
const DOMAINS = ['localhost', 'bay.everholt.com']
const ADMIN = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}`
const dryRun = process.argv.includes('--dry-run')

function token() {
  const file = join(homedir(), '.config/configstore/firebase-tools.json')
  const { tokens } = JSON.parse(readFileSync(file, 'utf8'))
  if (!tokens?.access_token) throw new Error('Not logged in: run `firebase login`.')
  if (Date.now() > tokens.expires_at - 60_000) {
    throw new Error('The CLI token has expired: run `firebase projects:list` to refresh it, then retry.')
  }
  return tokens.access_token
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'x-goog-user-project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

const current = await call('GET', `${ADMIN}/config`)
if (current.status === 404) {
  console.error(
    'Auth is not initialised for this project (CONFIGURATION_NOT_FOUND).\n' +
      `Open https://console.firebase.google.com/project/${PROJECT}/authentication and click "Get started", then rerun.`,
  )
  process.exit(1)
}
if (current.status !== 200) {
  console.error(`GET config: HTTP ${current.status}\n${JSON.stringify(current.json, null, 2)}`)
  process.exit(1)
}

if (!dryRun) {
  const domains = [...new Set([...(current.json.authorizedDomains ?? []), ...DOMAINS])]
  const patch = await call(
    'PATCH',
    `${ADMIN}/config?updateMask=signIn.email.enabled,authorizedDomains`,
    { signIn: { email: { enabled: false } }, authorizedDomains: domains },
  )
  if (patch.status !== 200) {
    console.error(`PATCH config: HTTP ${patch.status}\n${JSON.stringify(patch.json, null, 2)}`)
    process.exit(1)
  }
}

// Read back: what is live, not what was sent.
const after = await call('GET', `${ADMIN}/config`)
const google = await call('GET', `${ADMIN}/defaultSupportedIdpConfigs/google.com`)
const email = after.json.signIn?.email ?? {}
const live = {
  // The API omits a boolean that is false (proto3 JSON), so an absent `enabled`
  // IS off: test `!== true`, never `=== false`, which would read a correctly
  // disabled provider as still on.
  emailSignInOff: email.enabled !== true,
  emailSignIn: email,
  authorizedDomains: after.json.authorizedDomains ?? [],
  google: google.status === 200 ? { enabled: google.json.enabled === true } : `HTTP ${google.status}`,
}
console.log(JSON.stringify(live, null, 2))

const missing = [
  !live.emailSignInOff && 'Email/Password (and email link) switched off',
  ...DOMAINS.filter((d) => !live.authorizedDomains.includes(d)).map((d) => `authorised domain ${d}`),
  !(google.status === 200 && google.json.enabled === true) &&
    `Google provider (console: https://console.firebase.google.com/project/${PROJECT}/authentication/providers → Add new provider → Google → Enable → Save)`,
].filter(Boolean)
if (missing.length) {
  console.error(`Not live yet:\n- ${missing.join('\n- ')}`)
  process.exit(1)
}
console.log('Auth is configured.')
