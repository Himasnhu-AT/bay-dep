// Firestore rules for bay's invite-only access, against the emulator.
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
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const RULES =
  process.env.RULES_FILE ?? fileURLToPath(new URL('../firestore.rules', import.meta.url))
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8181').split(':')

const ADMIN = { uid: 'admin-uid', email: 'hyattherate2005@gmail.com' }
const ALICE = { uid: 'alice-uid', email: 'alice@example.com' } // approved
const BOB = { uid: 'bob-uid', email: 'bob@example.com' } // not approved
const CAROL = { uid: 'carol-uid', email: 'carol@example.com' } // not approved

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

/** Write state directly, bypassing the rules. */
async function seed(fn) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()))
}

/** A waitlist entry exactly as the website writes it, signed out. */
const joinPayload = (email, extra = {}) => ({
  email,
  createdAt: serverTimestamp(),
  status: 'pending',
  ...extra,
})

/** A signed-out client: joining the waitlist needs no account. */
const anon = () => env.unauthenticatedContext().firestore()

/** Join as a signed-out visitor, under `email` as both id and field. */
const join = (email, extra = {}, db = anon()) =>
  setDoc(doc(db, 'waitlist', email), joinPayload(email, extra))

const userDoc = (who, used = 0) => ({
  email: who.email,
  referralsUsed: used,
  createdAt: Timestamp.now(),
})

/** Seed `who` as approved, with a users doc at `used` referrals. */
async function approved(who, used = 0) {
  await seed(async (db) => {
    await setDoc(doc(db, 'access', who.email), {
      email: who.email,
      via: 'admin',
      grantedBy: ADMIN.uid,
      grantedAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'users', who.uid), userDoc(who, used))
  })
}

const referralGrant = (referrer, friendEmail, extra = {}) => ({
  email: friendEmail,
  via: 'referral',
  grantedBy: referrer.uid,
  grantedAt: serverTimestamp(),
  referrerEmail: referrer.email,
  ...extra,
})

/** The batch the desktop app commits: create the grant, +1 the counter, name the grant. */
function referBatch(db, referrer, friendEmail, { by = 1, grant = {}, counter = {} } = {}) {
  const b = writeBatch(db)
  b.set(doc(db, 'access', friendEmail), referralGrant(referrer, friendEmail, grant))
  b.update(doc(db, 'users', referrer.uid), {
    referralsUsed: increment(by),
    lastReferral: friendEmail,
    ...counter,
  })
  return b
}

// ---------------------------------------------------------------------------

describe('waitlist', () => {
  test('a signed-out visitor joins; so does a signed-in one', async () => {
    await assertSucceeds(join(BOB.email))
    await assertSucceeds(join(CAROL.email, {}, as(CAROL)))
  })

  test('a second join of the same address is refused; a different address is not', async () => {
    await assertSucceeds(join(BOB.email))
    await assertFails(join(BOB.email))
    await assertFails(join(BOB.email, {}, as(BOB)))
    await assertSucceeds(join(CAROL.email))
  })

  test('with a note of 500 chars: allowed; 501, or a note that is not a string: refused', async () => {
    await assertFails(join(BOB.email, { note: 'x'.repeat(501) }))
    await assertFails(join(BOB.email, { note: ['x'] }))
    await assertSucceeds(join(BOB.email, { note: 'x'.repeat(500) }))
  })

  test('the id must be the address, lowercase', async () => {
    await assertFails(setDoc(doc(anon(), 'waitlist', BOB.email), joinPayload(CAROL.email)))
    await assertFails(join('Bob@Example.com'))
    await assertSucceeds(join('bob@example.com'))
  })

  test('the id must be a strict email', async () => {
    for (const bad of ['not-an-email', 'bob@example', 'bob@example.c', 'bo b@example.com', 'bob@@example.com', 'bob@exa_mple.com', '@example.com']) {
      await assertFails(join(bad), `accepted ${bad}`)
    }
    await assertSucceeds(join('bob.o+bay@mail.example.co'))
  })

  test('the id is at most 254 characters', async () => {
    const at = (n) => 'a'.repeat(n - '@example.com'.length) + '@example.com'
    assert.equal(at(255).length, 255)
    await assertFails(join(at(255)))
    await assertSucceeds(join(at(254)))
  })

  test('status must be pending', async () => {
    await assertFails(join(BOB.email, { status: 'approved' }))
    await assertSucceeds(join(BOB.email))
  })

  test('createdAt must be the server time; no other keys', async () => {
    await assertFails(join(BOB.email, { createdAt: Timestamp.now() }))
    await assertFails(join(BOB.email, { uid: BOB.uid }))
    await assertFails(join(BOB.email, { priority: 1 }))
    await assertSucceeds(join(BOB.email))
  })

  test('a join missing a key is refused', async () => {
    const { status, ...noStatus } = joinPayload(BOB.email)
    const { createdAt, ...noCreatedAt } = joinPayload(BOB.email)
    assert.ok(status && createdAt)
    await assertFails(setDoc(doc(anon(), 'waitlist', BOB.email), noStatus))
    await assertFails(setDoc(doc(anon(), 'waitlist', BOB.email), noCreatedAt))
    await assertSucceeds(join(BOB.email))
  })

  test('nobody but the admin reads, lists, updates or deletes an entry, not even its owner', async () => {
    await assertSucceeds(join(BOB.email))
    await approved(ALICE)
    for (const db of [anon(), as(BOB), as(ALICE)]) {
      await assertFails(getDoc(doc(db, 'waitlist', BOB.email)))
      await assertFails(getDocs(collection(db, 'waitlist')))
      await assertFails(updateDoc(doc(db, 'waitlist', BOB.email), { status: 'approved' }))
      await assertFails(deleteDoc(doc(db, 'waitlist', BOB.email)))
    }
    const got = await assertSucceeds(getDoc(doc(as(ADMIN), 'waitlist', BOB.email)))
    assert.equal(got.data().status, 'pending')
    const snap = await assertSucceeds(getDocs(collection(as(ADMIN), 'waitlist')))
    assert.equal(snap.size, 1)
  })

  test("the owner's email unverified is not the admin", async () => {
    await assertSucceeds(join(BOB.email))
    await assertFails(getDocs(collection(as(ADMIN, { verified: false }), 'waitlist')))
    await assertFails(getDocs(collection(as(BOB, { email: 'VashisathAmanav@gmail.com' }), 'waitlist')))
    await assertSucceeds(getDocs(collection(as(ADMIN), 'waitlist')))
  })

  test('the admin approves: grant + status in one batch', async () => {
    await assertSucceeds(join(BOB.email))
    const db = as(ADMIN)
    const b = writeBatch(db)
    b.set(doc(db, 'access', BOB.email), {
      email: BOB.email,
      via: 'admin',
      grantedBy: ADMIN.uid,
      grantedAt: serverTimestamp(),
    })
    b.update(doc(db, 'waitlist', BOB.email), { status: 'approved' })
    await assertSucceeds(b.commit())
    await assertSucceeds(getDoc(doc(as(BOB), 'access', BOB.email)))
  })
})

// The website's /admin "Grant access" form: a direct grant with no waitlist
// entry behind it, the list of grants, and Revoke.
describe('admin grant form', () => {
  const adminGrant = (who) => ({
    email: who.email,
    via: 'admin',
    grantedBy: ADMIN.uid,
    grantedAt: serverTimestamp(),
  })

  test('the admin grants an email that never joined the waitlist; an unverified owner cannot', async () => {
    await assertFails(setDoc(doc(as(ADMIN, { verified: false }), 'access', CAROL.email), adminGrant(CAROL)))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'access', CAROL.email), adminGrant(CAROL)))
    const mine = await assertSucceeds(getDoc(doc(as(CAROL), 'access', CAROL.email)))
    assert.equal(mine.exists(), true)
  })

  test('the admin lists grants and revokes one; nobody else lists', async () => {
    await approved(ALICE)
    const snap = await assertSucceeds(getDocs(collection(as(ADMIN), 'access')))
    assert.deepEqual(snap.docs.map((d) => d.id), [ALICE.email])
    await assertFails(getDocs(collection(as(ALICE), 'access')))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'access', ALICE.email)))
    const gone = await assertSucceeds(getDoc(doc(as(ALICE), 'access', ALICE.email)))
    assert.equal(gone.exists(), false)
  })
})

// ---------------------------------------------------------------------------

describe('access', () => {
  test('a non-admin cannot write an admin grant', async () => {
    const grant = (who) => ({
      email: CAROL.email,
      via: 'admin',
      grantedBy: who.uid,
      grantedAt: serverTimestamp(),
    })
    await approved(ALICE)
    await assertFails(setDoc(doc(as(ALICE), 'access', CAROL.email), grant(ALICE)))
    await assertSucceeds(setDoc(doc(as(ADMIN), 'access', CAROL.email), grant(ADMIN)))
  })

  test('an unapproved user cannot create access for themself, either way', async () => {
    await seed((db) => setDoc(doc(db, 'users', BOB.uid), userDoc(BOB)))
    const db = as(BOB)
    await assertFails(
      setDoc(doc(db, 'access', BOB.email), {
        email: BOB.email,
        via: 'admin',
        grantedBy: BOB.uid,
        grantedAt: serverTimestamp(),
      }),
    )
    await assertFails(referBatch(db, BOB, BOB.email).commit())
  })

  test('an unapproved user cannot refer; an approved one can', async () => {
    await seed((db) => setDoc(doc(db, 'users', BOB.uid), userDoc(BOB)))
    await assertFails(referBatch(as(BOB), BOB, CAROL.email).commit())
    await approved(ALICE)
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
    const u = await getDoc(doc(as(ALICE), 'users', ALICE.uid))
    assert.equal(u.data().referralsUsed, 1)
  })

  test('an approved user refers five; the sixth is refused', async () => {
    await approved(ALICE)
    for (let i = 1; i <= 5; i++) {
      await assertSucceeds(referBatch(as(ALICE), ALICE, `friend${i}@example.com`).commit())
    }
    await assertFails(referBatch(as(ALICE), ALICE, 'friend6@example.com').commit())
    const u = await getDoc(doc(as(ALICE), 'users', ALICE.uid))
    assert.equal(u.data().referralsUsed, 5)
  })

  test('the counter cannot move by 2 (or 0, or -1)', async () => {
    await approved(ALICE, 2)
    for (const by of [2, 0, -1]) {
      await assertFails(referBatch(as(ALICE), ALICE, CAROL.email, { by }).commit())
    }
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email, { by: 1 }).commit())
  })

  test('a grant without the counter is refused', async () => {
    await approved(ALICE)
    await assertFails(
      setDoc(doc(as(ALICE), 'access', CAROL.email), referralGrant(ALICE, CAROL.email)),
    )
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
  })

  test('a re-grant after a revoke still costs a unit', async () => {
    // lastReferral already names carol from the first grant, so only the +1
    // check stops a second, free grant to the same address.
    await approved(ALICE)
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'access', CAROL.email)))
    await assertFails(
      setDoc(doc(as(ALICE), 'access', CAROL.email), referralGrant(ALICE, CAROL.email)),
    )
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
  })

  test('one +1 pays for one grant, not two', async () => {
    await approved(ALICE)
    const db = as(ALICE)
    const b = referBatch(db, ALICE, CAROL.email)
    b.set(doc(db, 'access', BOB.email), referralGrant(ALICE, BOB.email))
    await assertFails(b.commit())
    await assertSucceeds(referBatch(db, ALICE, CAROL.email).commit())
  })

  test('the grant must name the referrer truthfully', async () => {
    await approved(ALICE)
    const db = as(ALICE)
    await assertFails(
      referBatch(db, ALICE, CAROL.email, { grant: { referrerEmail: 'x@example.com' } }).commit(),
    )
    await assertFails(referBatch(db, ALICE, CAROL.email, { grant: { grantedBy: BOB.uid } }).commit())
    await assertFails(referBatch(db, ALICE, CAROL.email, { grant: { via: 'admin' } }).commit())
    await assertSucceeds(referBatch(db, ALICE, CAROL.email).commit())
  })

  test('a referral id must be a lowercase email', async () => {
    await approved(ALICE)
    await assertFails(referBatch(as(ALICE), ALICE, 'Carol@Example.com').commit())
    await assertFails(referBatch(as(ALICE), ALICE, 'not-an-email').commit())
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
  })

  test('the referrer cannot modify or delete a grant; the admin can revoke', async () => {
    await approved(ALICE)
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
    const db = as(ALICE)
    await assertFails(updateDoc(doc(db, 'access', CAROL.email), { via: 'admin' }))
    await assertFails(deleteDoc(doc(db, 'access', CAROL.email)))
    await assertFails(deleteDoc(doc(as(CAROL), 'access', CAROL.email)))
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'access', CAROL.email)))
  })

  test('the grantee reads their own access doc, present or absent', async () => {
    await approved(ALICE)
    const got = await assertSucceeds(getDoc(doc(as(ALICE), 'access', ALICE.email)))
    assert.equal(got.exists(), true)
    const none = await assertSucceeds(getDoc(doc(as(BOB), 'access', BOB.email)))
    assert.equal(none.exists(), false)
    await assertFails(getDoc(doc(as(ALICE, { verified: false }), 'access', ALICE.email)))
  })

  test("nobody reads others' access docs; the referrer and admin can", async () => {
    await approved(ALICE)
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
    await assertFails(getDoc(doc(as(BOB), 'access', ALICE.email)))
    await assertFails(getDoc(doc(as(BOB), 'access', CAROL.email)))
    await assertFails(getDoc(doc(as(CAROL), 'access', ALICE.email)))
    await assertSucceeds(getDoc(doc(as(ALICE), 'access', CAROL.email)))
    await assertSucceeds(getDoc(doc(as(ADMIN), 'access', CAROL.email)))
    await assertFails(getDocs(collection(as(ALICE), 'access')))
    await assertSucceeds(getDocs(collection(as(ADMIN), 'access')))
  })
})

// ---------------------------------------------------------------------------

describe('users', () => {
  const create = (who) => ({ email: who.email, referralsUsed: 0, createdAt: serverTimestamp() })

  test('self-create with 0 only', async () => {
    await assertFails(setDoc(doc(as(BOB), 'users', BOB.uid), { ...create(BOB), referralsUsed: 1 }))
    await assertFails(setDoc(doc(as(BOB), 'users', BOB.uid), { ...create(BOB), referralsUsed: -5 }))
    await assertSucceeds(setDoc(doc(as(BOB), 'users', BOB.uid), create(BOB)))
  })

  test('not for another uid, not with another email, not unverified', async () => {
    await assertFails(setDoc(doc(as(BOB), 'users', CAROL.uid), create(BOB)))
    await assertFails(setDoc(doc(as(BOB), 'users', BOB.uid), create(CAROL)))
    await assertFails(setDoc(doc(as(BOB, { verified: false }), 'users', BOB.uid), create(BOB)))
    await assertSucceeds(setDoc(doc(as(BOB), 'users', BOB.uid), create(BOB)))
  })

  test('cannot overwrite an existing users doc back to 0', async () => {
    await approved(ALICE, 5)
    await assertFails(setDoc(doc(as(ALICE), 'users', ALICE.uid), create(ALICE)))
  })

  test('read self and admin only', async () => {
    await approved(ALICE)
    await assertSucceeds(getDoc(doc(as(ALICE), 'users', ALICE.uid)))
    await assertSucceeds(getDoc(doc(as(ADMIN), 'users', ALICE.uid)))
    await assertFails(getDoc(doc(as(BOB), 'users', ALICE.uid)))
    await assertFails(getDocs(collection(as(ALICE), 'users')))
  })

  test('the counter cannot move without a new grant', async () => {
    await approved(ALICE)
    await approved(BOB)
    const ref = doc(as(ALICE), 'users', ALICE.uid)
    // No grant at all.
    await assertFails(updateDoc(ref, { referralsUsed: increment(1), lastReferral: CAROL.email }))
    // Naming a grant that already existed.
    await assertFails(updateDoc(ref, { referralsUsed: increment(1), lastReferral: BOB.email }))
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
  })

  test('a referral batch cannot rewrite other fields', async () => {
    await approved(ALICE)
    await assertFails(
      referBatch(as(ALICE), ALICE, CAROL.email, { counter: { email: 'x@example.com' } }).commit(),
    )
    await assertSucceeds(referBatch(as(ALICE), ALICE, CAROL.email).commit())
  })
})

// ---------------------------------------------------------------------------
// The desktop app talks REST, not the SDK, and reads status codes to choose its
// message. These pin the exact wire shapes it sends and the codes it gets back.

const PROJECT = 'demo-bay-rules'
const BASE = `http://${host}:${port}/v1/projects/${PROJECT}/databases/(default)/documents`
const NAME = `projects/${PROJECT}/databases/(default)/documents`

/** An unsigned ID token, which the emulator accepts; the claims are what the rules see. */
function idToken(who, { verified = true } = {}) {
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
      email_verified: verified,
      firebase: { sign_in_provider: 'google.com', identities: {} },
    }),
    '',
  ].join('.')
}

async function rest(who, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${idToken(who)}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const str = (s) => ({ stringValue: s })

/** Write A: create the grant, grantedAt from the server, must not exist yet. */
const writeGrant = (referrer, friend) => ({
  update: {
    name: `${NAME}/access/${friend}`,
    fields: {
      email: str(friend),
      via: str('referral'),
      grantedBy: str(referrer.uid),
      referrerEmail: str(referrer.email),
    },
  },
  updateTransforms: [{ fieldPath: 'grantedAt', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { exists: false },
})

/** Write B: +1 and name the grant it pays for. */
const writeCounter = (referrer, friend) => ({
  update: { name: `${NAME}/users/${referrer.uid}`, fields: { lastReferral: str(friend) } },
  updateMask: { fieldPaths: ['lastReferral'] },
  updateTransforms: [{ fieldPath: 'referralsUsed', increment: { integerValue: '1' } }],
  currentDocument: { exists: true },
})

describe('desktop REST shapes', () => {
  test('GET own access: 200 when granted, 404 when not; another’s: 403', async () => {
    await approved(ALICE)
    assert.equal((await rest(ALICE, 'GET', `/access/${ALICE.email}`)).status, 200)
    assert.equal((await rest(BOB, 'GET', `/access/${BOB.email}`)).status, 404)
    assert.equal((await rest(BOB, 'GET', `/access/${ALICE.email}`)).status, 403)
  })

  test('users create with createdAt=REQUEST_TIME and exists=false', async () => {
    const r = await rest(BOB, 'POST', ':commit', {
      writes: [
        {
          update: {
            name: `${NAME}/users/${BOB.uid}`,
            fields: { email: str(BOB.email), referralsUsed: { integerValue: '0' } },
          },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: false },
        },
      ],
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
  })

  test('the referral :commit: accepted with lastReferral, refused without it', async () => {
    await approved(ALICE)
    // A bare increment transform (no lastReferral) is what an earlier draft sent.
    const bare = {
      transform: {
        document: `${NAME}/users/${ALICE.uid}`,
        fieldTransforms: [{ fieldPath: 'referralsUsed', increment: { integerValue: '1' } }],
      },
      currentDocument: { exists: true },
    }
    const refused = await rest(ALICE, 'POST', ':commit', {
      writes: [writeGrant(ALICE, CAROL.email), bare],
    })
    assert.equal(refused.status, 403)
    const ok = await rest(ALICE, 'POST', ':commit', {
      writes: [writeGrant(ALICE, CAROL.email), writeCounter(ALICE, CAROL.email)],
    })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })

  test('referring someone who already has access: 403, not a precondition error', async () => {
    // Rules are evaluated before preconditions, and an existing access doc makes
    // the create an update, which only the admin may do. So "already has access"
    // cannot be told from "refused" by status: the app should GET access/{friend}
    // first (the referrer may read only grants they made) or say both.
    await approved(ALICE)
    await approved(BOB)
    const r = await rest(ALICE, 'POST', ':commit', {
      writes: [writeGrant(ALICE, BOB.email), writeCounter(ALICE, BOB.email)],
    })
    assert.equal(r.status, 403, JSON.stringify(r.body))
    const ok = await rest(ALICE, 'POST', ':commit', {
      writes: [writeGrant(ALICE, CAROL.email), writeCounter(ALICE, CAROL.email)],
    })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })
})

// The website joins the waitlist signed out, with one REST commit and no SDK
// (website/src/lib/firebase.ts, joinWaitlistRequest). This is that request, byte
// for byte in shape, and the codes the page reads: 200 joined, 403 refused (for
// a well-formed address, only because it is already on the list).
//
// It sends no `currentDocument: { exists: false }` precondition, on purpose.
// With one, a repeat join answers 409 ALREADY_EXISTS before the rules run, so
// the answer would differ from a malformed address's 403, and anyone could ask
// whether an address is on the list without adding it. Without it, a repeat is
// an update, the rules refuse it, and it is the same 403 as any other refusal.

/** The website's join, as it sends it: no Authorization header. */
async function websiteJoin(email, note, { precondition = false } = {}) {
  const res = await fetch(`${BASE}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: `${NAME}/waitlist/${email}`,
            fields: {
              email: str(email),
              status: str('pending'),
              ...(note ? { note: str(note) } : {}),
            },
          },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          ...(precondition ? { currentDocument: { exists: false } } : {}),
        },
      ],
    }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('website REST join', () => {
  test('signed out: 200 the first time, 403 the second; another address still 200', async () => {
    const first = await websiteJoin(BOB.email, 'Alice sent me')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal((await websiteJoin(BOB.email)).status, 403)
    assert.equal((await websiteJoin(CAROL.email)).status, 200)
    const got = await getDoc(doc(as(ADMIN), 'waitlist', BOB.email))
    assert.equal(got.data().note, 'Alice sent me')
  })

  test('why there is no precondition: with one, a repeat answers 409 and says the address is listed', async () => {
    assert.equal((await websiteJoin(BOB.email)).status, 200)
    assert.equal((await websiteJoin(BOB.email, undefined, { precondition: true })).status, 409)
    assert.equal((await websiteJoin(BOB.email)).status, 403)
  })

  test('a malformed address is 403 too, which is why the page checks it first', async () => {
    assert.equal((await websiteJoin('Bob@Example.com')).status, 403)
    assert.equal((await websiteJoin('bob@example')).status, 403)
    assert.equal((await websiteJoin(BOB.email)).status, 200)
  })
})

describe('default deny', () => {
  test('an unmatched collection is closed, even to the admin', async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'config', 'x'), { a: 1 }))
    await assertFails(getDoc(doc(as(ADMIN), 'config', 'x')))
  })

  test('signed out: a waitlist join and nothing else', async () => {
    await approved(ALICE)
    const db = anon()
    await assertFails(getDoc(doc(db, 'access', ALICE.email)))
    await assertFails(
      setDoc(doc(db, 'access', BOB.email), {
        email: BOB.email,
        via: 'admin',
        grantedBy: ADMIN.uid,
        grantedAt: serverTimestamp(),
      }),
    )
    await assertFails(getDoc(doc(db, 'users', ALICE.uid)))
    await assertSucceeds(join(BOB.email, {}, db))
  })
})
