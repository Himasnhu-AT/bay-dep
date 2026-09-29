@AGENTS.md

# website

The product site for Bay, the editor in the repository above this folder. Next.js 16
(app router), React 19, TypeScript, Tailwind v4, pnpm. Deployed on Vercel. Every page
prerenders; the only dynamic routes are the app's report endpoints under `/api`.

This site sells one thing. It is not a studio catalogue and it does not list sibling
apps. If a change starts describing a family of products, it belongs on the studio site
instead.

## The one rule that shapes everything

**The site is an argument that this software minds its own business, so the site has to
mind its own business too.** No analytics, no tag manager, no session recorder, no
embedded video player phoning home, no chat widget, no fonts fetched from Google at
runtime, no cookie banner because there is nothing to consent to. If a change adds a
request to a third party, it contradicts the thing the copy is claiming, and it is a
product decision rather than a technical one. Stop and raise it.

**There is one exception, it is deliberate, and it is narrow. Do not "fix" it away.**
Signing in is decided by Firebase (project `bay-editor-app`): Firebase Auth, Google only.
Anyone may download the app, and any Google account with a verified address is let in (the
owner's decision, 2026-09-29, which replaced the invitation and waitlist of 2026-09-23). So
the site's pages talk to Google, under three conditions that together are the rule:

- **Only on interaction.** Signing in with Google (on `/admin` and `/desktop/sign-in`)
  loads the SDK through `loadFirebase()`, a dynamic `import()` called from the button's
  handler. The one exception is a browser where the visitor signed in before (the
  `bay.signedIn` mark in localStorage, cleared on sign-out), which restores the session on
  arrival. No page does this on arrival otherwise: `/` and every other page make zero
  third-party requests until a button is pressed, and that was measured with a network
  capture. Measure it again after touching any of this.
- **Only for sign-in and the owner's dashboard.** The desktop app's sign-in courier, and
  `/admin`, where the owner reads the app's usage and crash reports. Never analytics about
  the site's visitors, never Firebase Analytics, never Performance Monitoring, never App
  Check's reCAPTCHA on page load, never a "while we're here". The site sends no email of
  any kind.
- **Only from one module.** `firebase/*` is imported in `src/lib/firebase.ts` and nowhere
  else (types excepted). A static import anywhere else puts the SDK in a page bundle and
  starts it before anyone asked. The route handlers do not use the SDK at all (below).

**The app reports to this site, and the copy says so.** The app sends anonymous usage
events and crash reports to `POST /api/telemetry` and `POST /api/crash`, on by default,
each with its own switch in the app's Preferences › Privacy. Projects, media, renders,
file paths, prompts and email addresses never leave the Mac. Every "What it will not do"
section, `/status` and the home page say exactly that and no more; VOICE.md has the
wording. The site's pages still load nothing from anyone on arrival: the endpoints are
things the app calls, not things a page calls.

- **The contract is `src/lib/telemetry.ts`.** It checks every field and names the bad
  one in the 400, ignores unknown keys (so a newer app is not refused), and takes home,
  volume and temp paths out of a crash's message and stack before anything is stored,
  whatever the app sent. The desktop app's client is written against it: change a limit
  there and the app must change with it. `EXPORT_EVENTS` names the two events `/admin`
  reads as "exports ok vs failed".
- **The request path is `src/lib/intake.ts`**: 256 KB cap (413), shape (400), a
  best-effort in-memory rate limit per installId + IP (429; the IP is never stored), then
  storage. **Storage is `src/lib/telemetry-store.ts`**: Firestore's REST API with a
  service account (`FIREBASE_SERVICE_ACCOUNT`, the JSON key, raw or base64), an OAuth
  token minted from a signed JWT with `node:crypto`, one `:commit` per request. It writes
  `telemetry_events` (one per event), `telemetry_daily/{day}` and
  `telemetry_installs/{day}_{installId}` (rollups, so `/admin` reads a doc per install
  per day rather than every event) and `crashes` (one per crash, with a `signature`).
  Without the credential the endpoints answer **503 "telemetry storage is not
  configured"**; they never answer 204 for a write that did not happen.
- **The Firestore rules are `../firebase/firestore.rules`**, with their emulator suite and
  mutation proof in `../firebase/`. The report collections are readable by the owner and
  writable by no browser; the service account is not governed by the rules.

Both routes are Node runtime and dynamic; every page still prerenders. Check the route
table in `pnpm build`'s output: only `/api/*` may be `ƒ`.

Fonts are self-hosted through `next/font`. Keep it that way.

## The second rule

**Nothing on this site may describe behaviour the app does not have.** `/status` is the
page the whole site exists to be able to write, and it is worthless the moment one row
of it is aspirational. Before adding a claim, check it against `../README.md` and the
code in `../src/`. When those change, this site changes with them. (The old
`../docs/native/parity-status.md` described the deleted Rust engine and survives only at
the `rust-engine-final` tag; do not cite it.)

## Read before editing

- [DESIGN.md](./DESIGN.md): tokens, type scale, spacing, components, motion, contrast.
  The theme lives in the `@theme` block in `src/app/globals.css`, not in components.
- [VOICE.md](./VOICE.md): how the copy sounds, how things are named, the status
  vocabulary. Copy goes through the humanizer rules: no em dashes, no rule of three, no
  promotional adjectives.

## Layout

```
src/app/            routes: /, /agents, /status, /compare, /download (302 to the DMG),
                    /desktop/sign-in and /admin (both noindex and unlinked),
                    /api/telemetry and /api/crash (POST, from the app)
src/lib/comparisons.ts  /compare's entries; scripts/encode-compare.sh encodes their media
src/components/     layout.tsx (the primitives), SiteNav, SiteFooter, Reveal,
                    DepthFallback; access/ holds the sign-in and access pages' clients
src/lib/product.ts  the name, kind, status, domain, contact, optional download
src/lib/firebase-config.ts  the project config and the owner's address, as plain data
src/lib/firebase.ts the lazy loader; the only firebase import
src/lib/access.ts   everything done with it: sign-in, the dashboard's reads
src/lib/telemetry.ts        the report contract (validation, path scrubbing, signature)
src/lib/intake.ts           the endpoints' request path; telemetry-store.ts, the writes
src/lib/dashboard.ts        what /admin makes of the rows it reads
```

`/desktop/sign-in?port=&state=` is the browser half of the desktop app's sign-in: it
posts `{state, idToken, refreshToken}` to `http://127.0.0.1:<port>/callback` and nowhere
else. The port and state are validated before anything is sent; the host is never read
from the URL. The app re-verifies everything itself, so this page is a courier, not an
authority.

## Conventions

- **The product name is a variable.** Read it from `src/lib/product.ts`. It is not typed
  into copy, metadata, class names, or comments. The name is unsettled, so a rename must
  stay a one-line edit.
- **Status is honest.** The four words are defined in VOICE.md and describe the app
  today. Do not promote it to balance a layout.
- **No download link without a build.** `download` is `/download`, this site's own route,
  which 302s to the newest notarized DMG (a release asset on a public GitHub repo; the
  site never names GitHub). It is the nav's one ask and the home page's button. Unset
  it and the nav and footer drop the link and the home page's close says there is no
  build today, rather than showing a dead button. The copy beside the button says macOS
  on Apple silicon, and that the app asks you to sign in with Google on first launch.
  There is no waitlist, invitation or referral, and no email capture of any kind.
- **Every page carries a "What it will not do" section.** The omissions are the reason
  the site is worth reading, and they are the first thing a rewrite tends to drop.
- **No screenshots until they are real.** A placeholder dates the page and nobody comes
  back to remove it. A gap is better.
- **New shapes go in `layout.tsx` and get documented in DESIGN.md in the same commit.**
  A page that invents its own layout is how the theme comes apart.
- **No new colours, sizes, or animations** without adding them to the `@theme` block and
  the tables in DESIGN.md. Re-measure contrast if you touch the palette.

## Commands

```bash
pnpm dev      # http://localhost:3000
pnpm build    # must pass before committing
pnpm lint
pnpm test     # node:test over src/**/*.test.ts (the report contract, intake, dashboard)
```

`pnpm test` runs under plain Node through `src/test-hooks.mjs`, which resolves `@/` and
extensionless imports. Node's type stripping refuses TypeScript-only syntax such as
constructor parameter properties, so the modules it loads avoid them.

**Deploying the endpoints.** Vercel needs `FIREBASE_SERVICE_ACCOUNT` (a service account
key for `bay-editor-app` with the Cloud Datastore User role, pasted as its JSON or as
base64 of it). The rules deploy from `../firebase`: `pnpm run deploy` there (not
`pnpm deploy`, a pnpm built-in).
