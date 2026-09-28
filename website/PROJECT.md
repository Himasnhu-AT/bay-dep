# website

The public face of Bay: a Mac video editor whose engine an agent can drive.

This is a product site, not a studio site. It has one thing to sell, so the home page is
the product page rather than a door into a catalogue.

## What it is for

Three jobs, in order of importance.

1. Make the wedge legible in one screen: the timeline and the agent endpoint are the same
   engine, and both run on your machine. Someone who reads only the hero should already
   understand what is different here.
2. Say where the app honestly is, including what is broken. `/status` is the point of the
   site, not a footer link.
3. Give someone a way to get a build when there is one to get.

It is not a funnel. There is no signup, no trial, no newsletter, and nothing to convert.

## What is built

- `/`: the product page. A hero that says what the app is and cues the scroll, the request
  in your own words, then the figure: your agent's conversation beside the editor,
  re-created on the page and pinned while a real build plays out one call per scroll.
  Then four things the sequence does not already show, what it will not do, where it
  actually is, and one link.
- `/agents`: how the engine is driven over MCP with the app open and with it closed, the
  commands you would type, and what the tool surface covers.
- `/status`: what works today, what is known to be wrong, and what has not been written.

## What is not built

- Screenshots and recordings. There are none, which is why the plate is a re-creation
  drawn from the app's own theme and layout source rather than a capture, and why the
  caption under it says exactly that. A real capture would be better and should replace
  it when one exists.
- Download hosting. `download` in `src/lib/product.ts` is `/download`, which redirects to
  the newest DMG uploaded as a release asset on a public GitHub repo (`src/app/download/`).
  The site itself serves no file and names no host.
- Documentation. The site links to nothing under `docs/`; that lives in the repository.

## Where the copy comes from

Every factual claim traces to the repository above this folder: `../README.md` for the
shape of the thing, and the code itself (`../src/`) for the delivered, open and deferred
lists behind `/status`. When those move, this site moves with them. A claim on this site
that no longer survives a reading of them is a bug. (`/status` was once written from
`docs/native/parity-status.md`, which went with the Rust engine; it survives only at the
`rust-engine-final` tag and describes nothing in this tree.)

The product name is unsettled. Everything reads it from `src/lib/product.ts`, so changing
it is a small edit.

## How it is built

Next.js 16 with the app router, React 19, TypeScript, Tailwind v4, pnpm. Every route is
static. Two typefaces, Fraunces and Inter, self-hosted through `next/font`. No third-party
requests at runtime, deliberately.
