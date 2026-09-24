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

Bay is a macOS video editor, an Electron app (React and TypeScript, ffmpeg for media and
export). It exists so that editing by hand and
editing by instruction are the same operation on the same document, performed by the same
engine, entirely on the user's machine.

Success for the site is that a visitor understands within one screen that the timeline and
the agent are not two products bolted together, and can check that claim against an honest
account of what is built.

## Positioning

**The engine is the product; the window is one way to reach it.** The editor's own project
model and store serve both the interface and an MCP server, so there is no second
implementation for an agent to disagree with. Concretely, and not copyable by an editor that
bolted an assistant onto its side:

- An agent never mutates the project around the editor. Every tool goes through the same
  store action a human's interaction uses, so an agent's edit appears on the timeline
  immediately and `⌘Z` undoes it like any other edit.
- An MCP client reaches the running app through a small proxy over a local socket; if the
  app is not running, the first tool call launches it.
- Everything is local. No server holds project data, and the agent endpoint is a socket on
  the user's own machine.

## Operating Context

- macOS first. ffmpeg ships inside the app.
- The agent is reached over the Model Context Protocol, added to a client as a stdio command
  (the app binary running bay's proxy script; see `../README.md`), or used from the agent
  panel inside the editor, which runs the user's own Claude Code sandboxed to bay's tools.
- Inside the editor the agent edits directly: every turn that changes the project ends with
  a list of what changed and a Revert button. "Ask before editing" in Settings makes it
  propose a plan and wait for approval instead.
- Speech is transcribed on the Mac with whisper.cpp. Its speech models are downloaded from
  Hugging Face when first needed (the one network exception, and a setting).

## Capabilities and Constraints

The live account of what works, what is wrong and what is not written is `/status`
(`src/app/status/page.tsx`), checked against `../README.md`. In outline: the editing loop end
to end (import, place, trim, slip, slide and roll, transitions, blend, captions, export
MP4, MOV or WebM); sixteen blend modes; 31 MCP tools (the catalog is
`../src/shared/mcp.ts`, and the count is whatever it holds) including rendering a frame to
look at, local transcription and export.

This section once described the Rust/GPUI engine (seventeen GPU blend modes, twenty-one MCP
tools, a low-frame-rate proxy for long clips). That engine is deleted; its record is at the
`rust-engine-final` tag.

Status is **In development**: real and running, not ready for a stranger. There is no
download, and the site must not imply one exists.

## Brand Commitments

- The product name is **Bay**, and it is unsettled. It lives in `src/lib/product.ts` and
  appears nowhere else, so a rename is one edit.
- Made by the studio **Everholt**, credited once in the footer. This is a product site, not
  a studio catalogue.
- The site must make no third-party requests at runtime: no analytics, no tag manager, no
  session recorder, no remotely fetched fonts, no embedded player. The site is an argument
  that the software minds its own business, so it has to as well. The one exception is
  access: the app is by invitation, and the sign-in, waitlist and admin pages load
  Firebase (Google) when the visitor presses a sign-in button, never on arrival. See
  CLAUDE.md, "The one rule".
- Voice rules are binding and live in VOICE.md: no em dashes, no rule of three, no
  promotional adjectives, second person, concrete over abstract.
- **Honesty is load-bearing.** `/status` is the page the site exists to be able to write.
  Nothing on the site may describe behaviour the app does not have.

## Evidence on Hand

Historical: the three items below describe the Rust engine, deleted; recover them with
`git show rust-engine-final:<path>` (paths relative to the repository root, `docs/native/…`
and `dep/rust/crates/bay-ui/…`).

- **A real end-to-end build**, documented in `../docs/native/reel-recipe.md`: "Volatility
  Drag", a 21.429s vertical infographic reel at 1080×1920, 30fps, h264 + AAC, driven
  entirely through MCP tool calls. It also records the four defects the build exposed, each
  found by looking at a rendered frame and each now covered by a test. This is the
  demonstration the homepage is built on.
- **The real interface**, in `../rust/crates/bay-ui/`: `theme.rs` carries the exact palette
  (ground `#0f0f14`, panel `#16161d`, lane `#121218`, border `#2a2a36`, text `#e7e7ee`,
  muted `#8a8a9a`, accent `#5b8cff`, selection `#2d3a66`) and the per-kind clip colours
  (video `#33628f`, image `#7a4f95`, text `#8f6a33`, audio `#2f8f63`). `editor_view.rs`
  carries the real toolbar and inspector labels.
- **An honest status record**, in `../docs/native/parity-status.md`: delivered, open and
  deliberately deferred.

Current (2026-09-24): the home page shows a real edit made in the Electron app. Four clips
from Pexels (`CREDITS.md`) and two generated sound beds were cut to detected beats, graded,
keyframed, dissolved, mixed (detached sound, J-cut, ducking) and exported with loudness
mastering, entirely through the app's tools; the tool log, the `.bay` project and the export
were kept by the author of that change. The plate re-creates the window from
`../src/renderer/src/` and shows frames the app rendered at each step; Fig. 2 shows the
downloaded clips beside the finished export. See DESIGN.md, "The plate" and "Before and
after".

Absences future work must not fabricate: there are **no screenshots or recordings of the
app's interface** on the site (the window on the plate is drawn), no users, no testimonials,
no benchmarks anyone has published, no download, and no pricing. What the site shows of the
app's output is that one credited edit, and it is captioned as such.

## Product Principles

1. **One engine, or the claim is dead.** Anything the site shows an agent doing must be
   something the timeline does the same way, through the same commands.
2. **Local is not a feature line, it is the architecture.** Say what does not exist (no
   server holding projects, no upload) rather than praising privacy. There is an account
   now, for access only: say what it is for and what it never carries.
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
