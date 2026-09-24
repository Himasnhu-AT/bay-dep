@AGENTS.md

# website

The product site for Bay, the editor in the repository above this folder. Next.js 16
(app router), React 19, TypeScript, Tailwind v4, pnpm. Deployed as static pages; every
route prerenders.

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
The app is by invitation (the owner's decision, 2026-09-23), and access is decided by
Firebase (project `bay-editor-app`): Firebase Auth for sign-in, Google only, and
Firestore for the `waitlist` and `access` collections. So the site talks to Google, under
three conditions that together are the rule:

- **Only on interaction.** Two things reach Google, and each starts with a press:
  - **Joining the waitlist** is one unauthenticated REST request to Firestore
    (`joinWaitlistRequest` in `src/lib/firebase.ts`), sent when the visitor presses "Join
    the waitlist". It loads no SDK and needs no account; the Firestore rules decide what
    it may write (a new, well-formed `waitlist/{email}` and nothing else).
  - **Signing in with Google** (checking access on `/waitlist`, `/admin`,
    `/desktop/sign-in`) loads the SDK through `loadFirebase()`, a dynamic `import()`
    called from the button's handler. The one exception is a browser where the visitor
    signed in before (the `bay.signedIn` mark in localStorage, cleared on sign-out),
    which restores the session on arrival.

  No page does either on arrival otherwise: `/` and every access page make zero
  third-party requests until a button is pressed, and that was measured with a network
  capture. Measure it again after touching any of this.
- **Only for access.** The waitlist join, sign-in, the grant check, and the owner's
  `/admin` (approve waitlist entries, grant an email directly, revoke). Never analytics,
  never Firebase Analytics, never Performance Monitoring, never App Check's reCAPTCHA on
  page load, never a "while we're here". The site sends no email of any kind.
- **Only from one module.** `firebase/*` is imported in `src/lib/firebase.ts` and nowhere
  else (types excepted), and the REST join lives there too. A static import anywhere else
  puts the SDK in a page bundle and starts it before anyone asked.

The copy says exactly this and no more: access is by invitation, you join the waitlist
with your address and no account, you sign in once with Google, the app
checks access with Google's sign-in service when online and works offline (14-day
recheck), and projects, media and renders never leave the machine. If the exception
grows, the copy has to grow with it, and that is again a product decision.

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
src/app/            routes: /, /agents, /status, /waitlist, /desktop/sign-in, /admin
                    (the last two are noindex and unlinked)
src/components/     layout.tsx (the primitives), SiteNav, SiteFooter, Reveal,
                    DepthFallback; access/ holds the sign-in and access pages' clients
src/lib/product.ts  the name, kind, status, domain, contact, optional download
src/lib/firebase.ts the Firebase config and the lazy loader; the only firebase import
src/lib/access.ts   everything done with it: sign-in, waitlist, grants, admin
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
- **No download link until there is a build.** `download` stays undefined and the home
  page shows a "Releasing soon" section instead, whose only action is the waitlist: it
  says there is no download yet rather than showing a dead button. The waitlist is not
  email capture standing in for a download: it is how access to the app is granted, it
  sends no mail at all, and it must never grow a newsletter checkbox.
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
```
