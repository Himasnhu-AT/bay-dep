# firebase/: bay's sign-in project and report store

This folder holds the Firestore security rules, their tests, and the deploy config for the
Firebase project `bay-editor-app`. It is its own pnpm package, independent of the app and of
`website/`.

## The model (since 2026-09-29)

Anyone may download bay, and any Google account with a verified address is let in. The app
decides that from the ID token; nothing in Firestore grants or refuses access any more. The
invitation model before it (a `waitlist`, `access` grants, `users` referral counters) was
retired by the owner on 2026-09-29; its rules and tests are in git history.

| Collection | What it is | Who writes it | Who reads it |
|---|---|---|---|
| `telemetry_events/{id}` | One usage event: the envelope (`v, installId, appVersion, os, osVersion, arch`), `name, at, props?`, `receivedAt, day` | The website's `/api/telemetry`, with a service account (not governed by these rules) | The owner only |
| `telemetry_daily/{day}` | Per UTC day: `events` and `counts.<event name>` | The same, as increments | The owner only |
| `telemetry_installs/{day}_{installId}` | One per install per day it reported, with its version and `events` | The same | The owner only |
| `crashes/{id}` | One crash report, with `signature`, `receivedAt, day` | The website's `/api/crash`, with the service account | The owner only |
| `access/{email}` | A grant from the invitation era | Nobody, any more | Its own verified owner, and the owner. Kept only so builds released before open access still let their already-granted users in; delete it once no such build is in use. |

No browser writes anything, the owner's included, so every report on `/admin` came through
the site's checks (`website/src/lib/telemetry.ts`).

**Owner** means `token.email == 'hyattherate2005@gmail.com'` and `email_verified == true`.

Anything outside these collections is denied, including to the owner.

## Commands

```bash
pnpm install
pnpm test             # rules tests on the Firestore emulator (needs a JDK, see below)
pnpm mutate           # weakens each key rule in turn and requires the suite to fail
pnpm run deploy       # deploys rules + indexes to bay-editor-app (NOT `pnpm deploy`: a pnpm built-in)
                      # (the same as: firebase deploy --only firestore:rules,firestore:indexes --project bay-editor-app)
pnpm auth:configure   # switches Email/Password (and email link) off, adds the authorised domains, requires Google, reads it all back
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
surface that refused everything would pass every negative control on its own. It covers the
owner reading (and running the dashboard's `day >=` query on) each report collection, everyone
else refused, no browser write to any of them, the legacy `access` read, and the retired
`waitlist` and `users` collections closed.

`test/mutate.mjs` checks that the suite catches each rule it guards. It also checks that each
replacement landed verbatim, replacing through a function, because a string replacement reads
`$'` as "the rest of the file". For each key rule it weakens that one rule in a temporary copy,
loaded through `$RULES_FILE`, and requires the suite to fail. It checks that every replacement
matches exactly once, and it runs the baseline before and after. The rules file on disk is
never edited.

## Auth setup, and the one step the API cannot do

On the Spark plan, the Identity Toolkit API cannot initialise Authentication.
`identityPlatform:initializeAuth` answers `BILLING_NOT_ENABLED`, and the config reads
`CONFIGURATION_NOT_FOUND` until the console has done it. So, once:

1. Open https://console.firebase.google.com/project/bay-editor-app/authentication and click **Get started**.
2. Go to **Sign-in method → Add new provider → Google → Enable**. Pick the support email, then
   **Save**. This creates the OAuth client, which no public API does.
3. Run `pnpm auth:configure`. It switches the **Email/Password** provider off (which also
   switches off the email link; the website no longer sends one), adds `localhost` and
   `bay.everholt.com` to the authorised domains, and prints the live config read back from the
   API. It exits non-zero unless email sign-in is off and Google is on. `--dry-run` only reads.

Google is the only way to sign in: on the website (`/admin`, `/desktop/sign-in`) and in the
desktop app.
