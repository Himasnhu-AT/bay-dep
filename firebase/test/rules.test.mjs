// Firestore rules for bay's open access and the app's reports, against the emulator.
//
// Every deny is paired with the nearest allow (CLAUDE.md: a surface that refuses
// everything passes every negative control). The rules file is read from
// $RULES_FILE when set, which is how test/mutate.mjs runs this suite against a
// deliberately weakened copy.
//
// Run: pnpm test (starts the emulator via `firebase emulators:exec`).

import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'

const RULES =
  process.env.RULES_FILE ?? fileURLToPath(new URL('../firestore.rules', import.meta.url))
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8181').split(':')

const OWNER = { uid: 'owner-uid', email: 'hyattherate2005@gmail.com' }
const ALICE = { uid: 'alice-uid', email: 'alice@example.com' }
const BOB = { uid: 'bob-uid', email: 'bob@example.com' }

const REPORTS = ['telemetry_events', 'telemetry_daily', 'telemetry_installs', 'crashes']

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bay-rules',
    firestore: { rules: readFileSync(RULES, 'utf8'), host, port: Number(port) },
  })
})

after(async () => {
  await env?.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
})

/** A client signed in as `who`; `verified: false` models an unverified email. */
function as(who, { verified = true, email = who.email } = {}) {
  return env.authenticatedContext(who.uid, { email, email_verified: verified }).firestore()
}

const anon = () => env.unauthenticatedContext().firestore()

/** Write state directly, bypassing the rules, as the website's service account does. */
async function seed(fn) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()))
}

/** One doc in each report collection, shaped as the website writes them. */
async function seedReports() {
  await seed(async (db) => {
    await setDoc(doc(db, 'telemetry_events', 'e1'), { name: 'app.launch', day: '2026-09-29', installId: 'i1' })
    await setDoc(doc(db, 'telemetry_daily', '2026-09-29'), { day: '2026-09-29', events: 1, counts: { 'app.launch': 1 } })
    await setDoc(doc(db, 'telemetry_installs', '2026-09-29_i1'), { day: '2026-09-29', installId: 'i1', appVersion: '0.9.3' })
    await setDoc(doc(db, 'crashes', 'c1'), { day: '2026-09-29', signature: 's', message: 'boom' })
  })
}

const firstId = { telemetry_events: 'e1', telemetry_daily: '2026-09-29', telemetry_installs: '2026-09-29_i1', crashes: 'c1' }

// ---------------------------------------------------------------------------

describe('reports', () => {
  test('the owner reads and lists every report collection, including the dashboard query', async () => {
    await seedReports()
    const db = as(OWNER)
    for (const name of REPORTS) {
      const got = await assertSucceeds(getDoc(doc(db, name, firstId[name])))
      assert.equal(got.exists(), true, name)
      const snap = await assertSucceeds(getDocs(query(collection(db, name), where('day', '>=', '2026-09-23'))))
      assert.equal(snap.size, 1, name)
    }
  })

  test('nobody else reads or lists them: a user, an unverified owner, a signed-out visitor', async () => {
    await seedReports()
    const others = [as(ALICE), as(OWNER, { verified: false }), as(BOB, { email: 'Hyattherate2005@gmail.com.evil' }), anon()]
    for (const db of others) {
      for (const name of REPORTS) {
        await assertFails(getDoc(doc(db, name, firstId[name])))
        await assertFails(getDocs(collection(db, name)))
      }
    }
    await assertSucceeds(getDocs(collection(as(OWNER), 'crashes')))
  })

  test('no browser writes a report, the owner included; only the server credential does', async () => {
    await seedReports()
    for (const db of [as(OWNER), as(ALICE), anon()]) {
      for (const name of REPORTS) {
        await assertFails(setDoc(doc(db, name, 'new'), { day: '2026-09-29' }))
        await assertFails(updateDoc(doc(db, name, firstId[name]), { day: 'x' }))
        await assertFails(deleteDoc(doc(db, name, firstId[name])))
      }
    }
    // The positive control: the same write, made the way the website's server makes it.
    await seed((db) => setDoc(doc(db, 'crashes', 'new'), { day: '2026-09-29' }))
    const got = await getDoc(doc(as(OWNER), 'crashes', 'new'))
    assert.equal(got.exists(), true)
  })
})

describe('access (builds released before open access)', () => {
  const grant = (who) => ({ email: who.email, via: 'admin', grantedBy: OWNER.uid, grantedAt: Timestamp.now() })

  test('a verified user reads their own grant, present or absent', async () => {
    await seed((db) => setDoc(doc(db, 'access', ALICE.email), grant(ALICE)))
    const mine = await assertSucceeds(getDoc(doc(as(ALICE), 'access', ALICE.email)))
    assert.equal(mine.exists(), true)
    const none = await assertSucceeds(getDoc(doc(as(BOB), 'access', BOB.email)))
    assert.equal(none.exists(), false)
  })

  test("nobody reads another's grant; an unverified user not even their own; the owner can", async () => {
    await seed((db) => setDoc(doc(db, 'access', ALICE.email), grant(ALICE)))
    await assertFails(getDoc(doc(as(BOB), 'access', ALICE.email)))
    await assertFails(getDoc(doc(as(ALICE, { verified: false }), 'access', ALICE.email)))
    await assertFails(getDoc(doc(anon(), 'access', ALICE.email)))
    await assertSucceeds(getDoc(doc(as(OWNER), 'access', ALICE.email)))
  })

  test('nothing creates, changes, lists or deletes a grant any more, the owner included', async () => {
    await seed((db) => setDoc(doc(db, 'access', ALICE.email), grant(ALICE)))
    for (const db of [as(OWNER), as(BOB)]) {
      await assertFails(setDoc(doc(db, 'access', BOB.email), grant(BOB)))
      await assertFails(updateDoc(doc(db, 'access', ALICE.email), { via: 'x' }))
      await assertFails(deleteDoc(doc(db, 'access', ALICE.email)))
      await assertFails(getDocs(collection(db, 'access')))
    }
    await assertSucceeds(getDoc(doc(as(ALICE), 'access', ALICE.email)))
  })
})

// An older desktop build reads its grant over REST and reads the status code.
const PROJECT = 'demo-bay-rules'
const BASE = `http://${host}:${port}/v1/projects/${PROJECT}/databases/(default)/documents`

/** An unsigned ID token, which the emulator accepts; the claims are what the rules see. */
function idToken(who) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      iat: now,
      exp: now + 3600,
      auth_time: now,
      sub: who.uid,
      user_id: who.uid,
      email: who.email,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com', identities: {} },
    }),
    '',
  ].join('.')
}

describe('older desktop REST shapes', () => {
  test('GET own access: 200 when granted, 404 when not; another’s: 403', async () => {
    await seed((db) =>
      setDoc(doc(db, 'access', ALICE.email), { email: ALICE.email, via: 'admin', grantedBy: OWNER.uid, grantedAt: Timestamp.now() }),
    )
    const get = async (who, email) =>
      (await fetch(`${BASE}/access/${email}`, { headers: { Authorization: `Bearer ${idToken(who)}` } })).status
    assert.equal(await get(ALICE, ALICE.email), 200)
    assert.equal(await get(BOB, BOB.email), 404)
    assert.equal(await get(BOB, ALICE.email), 403)
  })
})

describe('default deny', () => {
  test('the old waitlist and users collections are closed to everyone, the owner included', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'waitlist', BOB.email), { email: BOB.email, status: 'pending' })
      await setDoc(doc(db, 'users', ALICE.uid), { email: ALICE.email, referralsUsed: 0 })
    })
    for (const db of [as(OWNER), as(ALICE), anon()]) {
      await assertFails(getDoc(doc(db, 'waitlist', BOB.email)))
      await assertFails(setDoc(doc(db, 'waitlist', 'carol@example.com'), { email: 'carol@example.com', status: 'pending' }))
      await assertFails(getDoc(doc(db, 'users', ALICE.uid)))
      await assertFails(setDoc(doc(db, 'users', BOB.uid), { email: BOB.email, referralsUsed: 0 }))
    }
    await assertSucceeds(getDoc(doc(as(OWNER), 'crashes', 'none')))
  })

  test('an unmatched collection is closed, even to the owner', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'config', 'x'), { a: 1 }))
    await assertFails(getDoc(doc(as(OWNER), 'config', 'x')))
    await assertSucceeds(getDoc(doc(as(OWNER), 'telemetry_daily', 'x')))
  })
})
