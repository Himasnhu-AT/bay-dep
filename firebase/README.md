# firebase/: bay's invite-only access

This folder holds the Firestore security rules, their tests, and the deploy config for the
Firebase project `bay-editor-app`. The project is on the Spark (free) plan, which has **no
Cloud Functions**. The rules in `firestore.rules` are the only thing that enforces who gets
access. The website and the desktop app are clients of these rules and are not trusted.

This is its own pnpm package, independent of the app and of `website/`.

## The model

Every document id is an email, lowercased and trimmed. The one exception is `users`, which is
keyed by uid.

| Collection | What it is | Who writes it | Who reads it |
|---|---|---|---|
| `waitlist/{email}` | A request for access: `email, uid, createdAt, status:'pending', note?` (a note is at most 500 chars) | The signed-in user creates their own entry, with a verified email and exactly these keys. Only the admin can update or delete an entry. | The requester (their own entry) and the admin. Only the admin can list. |
| `access/{email}` | A grant: `email, via:'admin'\|'referral', grantedBy, grantedAt, referrerEmail?` | The admin creates admin grants. An approved user creates referral grants (see below). Only the admin can update or delete a grant (revoking means deleting it). | The grantee, the referrer (grants they made) and the admin. Only the admin can list. |
| `users/{uid}` | Referral counter: `email, referralsUsed (0..5), createdAt, lastReferral?` | The user creates their own doc with `referralsUsed: 0`. After that, the user can change it only inside a referral batch. The admin can update or delete it. | The user themself and the admin. |

**Entitlement** means `access/{token.email}` exists **and** the token's `email_verified` is
true.

**Admin** means `token.email == 'vashisathamanav@gmail.com'` and `email_verified == true`. The
admin is recognised by the verified email alone, so no custom claims are needed.

Anything outside these three collections is denied, including to the admin.

### A referral is one batch of two writes

1. Create `access/{friend}` with `via:'referral'`, `grantedBy: <uid>`,
   `referrerEmail: <own email>` and `grantedAt: <request time>`.
2. Update `users/{uid}` with `referralsUsed: +1` and `lastReferral: <friend>`.

The grant's rule checks the referrer's state from **before** the batch:
`exists(access/{own email})`, so approving yourself in the same batch does not count. It then
uses `getAfter` to check the referrer's `users` doc: the counter rose by exactly 1, stays at or
below 5, and `lastReferral` names this grant. The users rule accepts a self-update only if it
touches just those two fields and names a grant that did not exist before the batch and does
after it.

`lastReferral` closes a hole. Without it, one +1 pays for any number of grants in a single batch,
because each grant's rule sees `before + 1 == after`.

## The admin flow

Approving a waitlist entry is one batch, run by the admin from the website's admin page:

```js
const b = writeBatch(db)
b.set(doc(db, 'access', email), { email, via: 'admin', grantedBy: adminUid, grantedAt: serverTimestamp() })
b.update(doc(db, 'waitlist', email), { status: 'approved' })
await b.commit()
```

Revoking a grant means deleting `access/{email}`. The admin can also create a grant directly,
without a waitlist entry, and can reset a user's counter by updating `users/{uid}`.

## Commands

```bash
pnpm install
pnpm test             # rules tests on the Firestore emulator (needs a JDK, see below)
pnpm mutate           # weakens each key rule in turn and requires the suite to fail
pnpm deploy           # deploys rules + indexes to bay-editor-app
pnpm auth:configure   # turns on email-link sign-in and the authorised domains, then reads them back
```

The emulator needs Java 21 or newer. It is keg-only from Homebrew, so the JDK is not on `PATH`:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@26 PATH=/opt/homebrew/opt/openjdk@26/bin:$PATH
```

`firebase` must be on `PATH` (firebase-tools 15.x). The test scripts run the suite with
`$npm_node_execpath`, not `node`. The standalone `firebase` binary puts its own embedded node
first on the child's `PATH`, and that node treated `--test` as a script path.

## What the tests prove

`test/rules.test.mjs` pairs every refusal with the nearest call that must still succeed. A
surface that refused everything would pass every negative control on its own. The tests in
`desktop REST shapes` pin the exact REST writes the desktop app sends, and the status codes it
gets back, which the app uses to choose its error messages.

`test/mutate.mjs` checks that the suite catches each rule it guards. For each key rule it
weakens that one rule in a temporary copy, loaded through `$RULES_FILE`, and requires the suite
to fail. It checks that every replacement matches exactly once, and it runs the baseline before
and after. The rules file on disk is never edited.

## Auth setup, and the one step the API cannot do

On the Spark plan, the Identity Toolkit API cannot initialise Authentication.
`identityPlatform:initializeAuth` answers `BILLING_NOT_ENABLED`, and the config reads
`CONFIGURATION_NOT_FOUND` until the console has done it. So, once:

1. Open https://console.firebase.google.com/project/bay-editor-app/authentication and click **Get started**.
2. Go to **Sign-in method → Add new provider → Google → Enable**. Pick the support email, then
   **Save**. This creates the OAuth client, which no public API does.
3. Run `pnpm auth:configure`. It enables **Email link (passwordless)**, adds `localhost` and
   `bay.everholt.com` to the authorised domains, and prints the live config read back from the
   API. It exits non-zero while anything is still missing.
