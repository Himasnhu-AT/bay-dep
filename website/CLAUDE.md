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

Fonts are self-hosted through `next/font`. Keep it that way.

## The second rule

**Nothing on this site may describe behaviour the app does not have.** `/status` is the
page the whole site exists to be able to write, and it is worthless the moment one row
of it is aspirational. Before adding a claim, check it against `../README.md` and
`../docs/native/parity-status.md`. When those change, this site changes with them.

## Read before editing

- [DESIGN.md](./DESIGN.md): tokens, type scale, spacing, components, motion, contrast.
  The theme lives in the `@theme` block in `src/app/globals.css`, not in components.
- [VOICE.md](./VOICE.md): how the copy sounds, how things are named, the status
  vocabulary. Copy goes through the humanizer rules: no em dashes, no rule of three, no
  promotional adjectives.

## Layout

```
src/app/            routes: /, /agents, /status
src/components/     layout.tsx (the primitives), SiteNav, SiteFooter, Reveal
src/lib/product.ts  the name, kind, status, domain, contact, optional download
```

## Conventions

- **The product name is a variable.** Read it from `src/lib/product.ts`. It is not typed
  into copy, metadata, class names, or comments. The name is unsettled, so a rename must
  stay a one-line edit.
- **Status is honest.** The four words are defined in VOICE.md and describe the app
  today. Do not promote it to balance a layout.
- **No download link until there is a build.** `download` stays undefined and the button
  does not render. No "coming soon" buttons, no email capture standing in for one.
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
