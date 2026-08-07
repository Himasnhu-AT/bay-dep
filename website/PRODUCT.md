# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who edit video on a Mac and are comfortable pointing an AI agent at their own
machine. Two situations, one product:

- **At the timeline.** Someone cutting a piece by hand who wants the ordinary editor
  affordances to be good: import, trim, transform, blend, play, export.
- **At the prompt.** Someone who would rather describe the change than perform it, and who
  expects the result to land in the document they are already looking at, not in a
  separate export they have to reconcile.

The second is the audience the site is written for, because it is the one no other editor
serves. They are technical enough to run a command and add an MCP server to their client.

## Product Purpose

Bay is a native macOS video editor written in Rust. It exists so that editing by hand and
editing by instruction are the same operation on the same document, performed by the same
engine, entirely on the user's machine.

Success for the site is that a visitor understands within one screen that the timeline and
the agent are not two products bolted together, and can check that claim against an honest
account of what is built.

## Positioning

**The engine is the product; the window is one way to reach it.** A single Rust engine
serves both the GPUI desktop shell and an MCP server, so there is no second implementation
for an agent to disagree with. Concretely, and not copyable by an editor that bolted an
assistant onto its side:

- An agent never mutates the project directly. It hands over the same `Command` values a
  human's interaction produces, applied at one single-writer point. So an agent's edit
  appears on the timeline immediately and `⌘Z` undoes it like any other edit.
- The same engine runs headless (`--mcp`), so a cut can be built and encoded with no
  window, no display, and no second code path.
- Everything is local. No server holds project data, and the agent endpoint binds to the
  user's own machine.

## Operating Context

- macOS, Apple Silicon first. Requires `ffmpeg` on `PATH` and a GPU adapter; both degrade
  with a message rather than failing silently.
- The agent is reached over the Model Context Protocol, added to a client with something
  like `claude mcp add --transport http bay http://127.0.0.1:7333/mcp`.
- Single-window by design: a second launch raises the existing window rather than opening a
  rival timeline, so which document the agent is editing is never ambiguous. The bound port
  is the lock.
- The app already surfaces agent activity in its own chrome: a chip reading `● Claude ·
  <label>` appears for 2.5 seconds after each agent edit.

## Capabilities and Constraints

Confirmed and working: the editing loop end to end (import, place, trim, transform, blend,
play back, export MP4); seventeen blend modes on the GPU; twenty-one MCP tools including
frame snapshot and render; local text to speech with captions cut to the spoken words; a
decode path that runs off the render path under a global memory budget; a universal Mac
app and `.dmg` built locally.

Known wrong, and stated publicly: long clips play as a low-frame-rate proxy; the media
panel lists three demo tiles rather than imported media; anamorphic sources render at the
wrong aspect; a rotation-metadata sign bug flips some phone footage.

Not written: most timeline craft (slip/slide/roll trims, transport, audio mixer, much of
the inspector); a reliable Windows target; signing and notarization.

Status is **In development**: real and running, not ready for a stranger. There is no
download, and the site must not imply one exists.

## Brand Commitments

- The product name is **Bay**, and it is unsettled. It lives in `src/lib/product.ts` and
  appears nowhere else, so a rename is one edit.
- Made by the studio **Everholt**, credited once in the footer. This is a product site, not
  a studio catalogue.
- The site must make no third-party requests at runtime: no analytics, no tag manager, no
  session recorder, no remotely fetched fonts, no embedded player. The site is an argument
  that the software minds its own business, so it has to as well.
- Voice rules are binding and live in VOICE.md: no em dashes, no rule of three, no
  promotional adjectives, second person, concrete over abstract.
- **Honesty is load-bearing.** `/status` is the page the site exists to be able to write.
  Nothing on the site may describe behaviour the app does not have.

## Evidence on Hand

- **A real end-to-end build**, documented in `../docs/native/reel-recipe.md`: "Volatility
  Drag", a 21.429s vertical infographic reel at 1080×1920, 30fps, h264 + AAC, driven
  entirely through MCP tool calls. It also records the four defects the build exposed, each
  found by looking at a rendered frame and each now covered by a test. This is the
  demonstration the homepage is built on.
- **The real interface**, in `../rust/crates/vii-ui/`: `theme.rs` carries the exact palette
  (ground `#0f0f14`, panel `#16161d`, lane `#121218`, border `#2a2a36`, text `#e7e7ee`,
  muted `#8a8a9a`, accent `#5b8cff`, selection `#2d3a66`) and the per-kind clip colours
  (video `#33628f`, image `#7a4f95`, text `#8f6a33`, audio `#2f8f63`). `editor_view.rs`
  carries the real toolbar and inspector labels.
- **An honest status record**, in `../docs/native/parity-status.md`: delivered, open and
  deliberately deferred.

Absences future work must not fabricate: there are **no screenshots, recordings, renders or
frames of the app**, no users, no testimonials, no benchmarks anyone has published, no
download, and no pricing. A UI shown on the site is a re-creation built from the source
above, and it is captioned as one.

## Product Principles

1. **One engine, or the claim is dead.** Anything the site shows an agent doing must be
   something the timeline does the same way, through the same commands.
2. **Local is not a feature line, it is the architecture.** Say what does not exist (no
   server, no account, no upload) rather than praising privacy.
3. **The unbuilt parts are published.** An honest limit stated first is worth more than a
   capability claimed loosely, and it is the only reason to believe the rest.
4. **Show the real thing or show nothing.** No placeholder screenshots, no stock renders,
   no invented output. A gap is better than an asset that dates the page or lies on it.
5. **Concrete over abstract.** A command, a file size, a frame rate, a tool count. If a
   sentence would survive being moved to a competitor's site, it is not saying anything.

## Accessibility & Inclusion

- Contrast is measured against the page ground, not eyeballed. The existing table in
  DESIGN.md is authoritative for the paper world and must be extended, with measured
  ratios, for any new surface.
- Reduced motion is honored: `prefers-reduced-motion: reduce` must leave the page fully
  readable with every transform and transition cleared. A scroll-driven sequence needs a
  static, complete equivalent.
- No content may depend on a script having run. The hidden pre-state is scoped to
  `@media (scripting: enabled)`.
- Keyboard reachability and visible focus (brass 1px outline, 3px offset) are global and
  must not be removed.
