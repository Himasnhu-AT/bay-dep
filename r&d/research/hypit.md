# hypit — what it is, and what bay should take from it

Studied 2026-09-27 from a shallow clone of `github.com/hypit-ai/hypit` at
`557497b` (2026-09-26), in `/tmp/hypit-study-20117`. Paths below are relative to that repo unless
they start with `src/` (bay). Everything marked **unverified** was read from docs, not run: I did
not install hypit, run a Build, or open Studio.

## 1. What it is

**One line:** a TypeScript toolchain plus one big Claude Code / Codex skill that lets a coding agent
"clone" a reference short-form video into a re-runnable, word-anchored composition (XML-ish
`.svml` source + CSS-ish `.svs` style sheets), generate the changed material through hosted models,
and render it by screenshotting headless Chromium.

Tagline (README): *"Clone any viral video with AI agents — 1 command, 100 variants, 100M views."*
Installed with `npx skills add hypit-ai/hypit -g`; the agent then drives a `hypit` CLI.

**Licence** — *not* Apache-2.0, despite the badge. `LICENSE` is "a modified version of the Apache
License 2.0" (GitHub reports `NOASSERTION`). The clauses that matter for bay:

> b. Commercial redistribution: Unless explicitly authorized by Hypit.AI in writing, you may not
> sell, license for a fee, or otherwise supply for commercial gain Hypit or any derivative work of
> it, whether standalone or as a component of, or bundled with, any product, application, package,
> or device provided to third parties.

> Forking, modifying, and publishing the source code of Hypit or a derivative work is permitted,
> provided the result is made available under the terms of this same license and is not supplied
> for commercial gain.

> c. LOGO and copyright information: … you may not remove or modify the name, LOGO, or copyright
> information presented in the Hypit command-line interface, its generated run reports and
> manifests, or any user-facing surface derived from them.

> 2. As a contributor … b. Your contributed code may be used for commercial purposes, including
> but not limited to its cloud business operations.

Output is the user's (clause 3). **Consequence for bay: no hypit code, docs text, `.svs` kits or
preview images may be copied into bay** — bay is a product shipped to third parties, which is
exactly clause 1b, and a derivative would also inherit the share-alike and logo terms. Ideas,
architecture and facts (e.g. "speech runs ~1.25× longer in non-English") are not copyrightable
and are fine; bay already cites hypit this way (`src/main/agent/prompt.ts:11`,
`src/shared/speech-duration.ts:8`). Write everything bay-side from scratch, in bay's words.

**Stack:** Node ≥22.15, pnpm 10 workspace, TypeScript 5.9, ~120 packages under `packages/`
(`@hypit/*`, all `private`, published as one `@hypit/hypit` "Distribution" v0.2.16).
Rendering through `@hyperframes/engine` + `@hyperframes/producer` 0.7.101 over `puppeteer-core`
(`packages/provider-hyperframes-local/package.json`); `sharp` for images; Python services via `uv`
for WhisperX, OpenCV and yt-dlp (`services/`). Docs site on VitePress. Full Chinese mirror of docs.

**Maturity (GitHub API, 2026-09-27):** created 2026-07-29; 16,412 stars, 1,984 forks, 15 open
issues, ≥20 contributors. Very active: the last 100 commits span 2026-09-17 → 2026-09-26 (~10/day).
Launch-partner and affiliate links in the README (HypiHub, HiAPI, Pollo, BeatAPI…) — the business
model is the recommended hosted generation service. Tests exist per package (`packages/*/test`),
run through `test/run.mjs`; I did not run them.

## 2. Architecture and data model

### The pipeline

`Script` (words, with speaker roles and named spans) → generated or supplied **Takes** →
**WhisperX SemanticTake** aligns each take's audio to the script words → **Timeline** of takes →
**Tracks** (caption, media/B-roll, performance, ranking board, audio…) whose timing is expressed
*against script spans*, not seconds → **Film** stacks tracks on a Canvas → **render:Video** turns
the composition into an HTML document (`HyperframesDocument`) that Chromium screenshots frame by
frame, in up to 64 parallel processes (README example). A **Run** (`.svrun`) picks which outputs
to build and which earlier results to reuse; a **Runtime Profile** (`hypit.runtime.json`) binds
capabilities to providers and credentials (`docs/guide/runtime.md`).

The distinctive idea is **time anchored to words**. From `examples/ranking-football/reference.svml:34`:

```xml
<script id="story">
  <ronaldo>
    <HOST>Ronaldo is <D | Dee> tier. || Bro has @{hair-gel} more || hair gel than @{trophy} trophies
      || at this point.@{/trophy}@{/hair-gel} || Built like || @{greek-god} a Greek god, || …
  </ronaldo>
```

`||` is a caption break, `<D | Dee>` is display|pronunciation, `@{hair-gel}…@{/hair-gel}` names a
Selection. A B-roll item then says `during={story.selection.hair-gel}` and follows those words
wherever the new take puts them. Re-voice, translate, or regenerate the performer and every graphic
re-flows. This is what makes "one workflow, 100 variants" work.

### How styles are defined: SVS Recipes

A "style" in hypit is not a skill; it is an **SVS Recipe** — a typed, CSS-shaped record consumed
by a component (`docs/quickstart/styles.md`). From `examples/ranking-football/recipes.svs` (trimmed):

```css
<?svml using="@hypit/svs@1"?>
<sheet version="1">
  speaker.host {                       /* prompt axes for generated performance */
    composition-stability: strict-locked;
    edit-rhythm: pause-trim-jump-cuts;
    performance: high-energy-ugc;
    gesture: expressive;
  }
  ranking.football {                   /* a component's look */
    rows: [ { "id": "s", "label": "S", "color": "#EE5F52" }, … ];
    board-background: #2B2B30;
    appear-frames: 8;  move-frames: 14;
  }
</sheet>
```

and it is applied by reference: `<ranking:TierBoardStyle recipe={recipes.ranking.football} font={tier-font}/>`.
Caption styles switch over time with `<caption-fine:Use during={story.selection.answer} style={answer-style}/>`
or `role="GUEST"` (`skills/hypit/references/production/caption-presentation.md`).

Each component declares every recipe property with a type, fallback and a **one-sentence summary
that carries design judgment**, e.g. `packages/caption-fine/src/manifest.ts:99`:

> `stroke-width` … "the number that matters is its share of `size`: about a twentieth. At a `size`
> of 46 that is 2px … Past about a tenth of `size` neighbouring letters meet, the counters fill in,
> and the caption reads as a slab rather than as words."

Caption motion is a closed enum of 24 one-shot entrances (`packages/caption-fine/src/recipe.ts:3`:
`fade, pop, spring, stamp, zoom-blur, blur-in, wipe-*`…).

**Prompt Kits** are the other "style" object: data-only `.svs` text templates with fixed blocks and
slots (`packages/gpt-image-kits/kits/phone-ugc-v1.svs`, `packages/seedance-kits/kits/{broll,podcast,
speaker,street-interview,call,camera-reference,motion-reference}-v1.svs`), with finite axes like
`performance: natural-explainer | high-energy-ugc | calm-authority | reactive-playful`.
(bay already has the equivalent: `fill_prompt_kit`, `src/shared/prompt-kits.ts`.)

### How they are searched

No semantic search, no registry. Discovery is **`hypit vocabulary`**
(`packages/video-cli/src/vocabulary.ts`):

- `hypit vocabulary` — every package visible to the project, with its tags and models;
- `hypit vocabulary @hypit/caption-fine [--tag Style]` — each Surface's module, import line,
  summary, `appearance`, attributes (with recipe properties), children, ports, a runnable
  `example`, notes, README path, and the **preview path** (`printableVocabulary`, line 136);
- `hypit vocabulary --visual [shape]` — the drawing value shapes a component must emit.

The skill tells the agent *how* to search: name the role first ("what does the viewer perceive and
why?"), then query likely owners (`skills/hypit/references/production/vocabulary.md:6`). Sharing is
plain npm (tarball or private registry); "it does not require a Hypit-specific registry".

### How they are previewed

Each Surface can declare `preview: { mediaType, path, open() }` (`packages/markup/src/types.ts:168`).
Ten Surfaces ship one — `packages/caption-fine/preview/Track.png`, `ranking/preview/TierBoard.svg`,
`typography-track/preview/{Track,Mask}.png`, `deck-track/preview/DepthStack.png`, etc.
(`packages/*/src/manifest.ts`, e.g. `caption-fine/src/manifest.ts:305`). The preview is **rendered
by the package's own pipeline from a checked-in catalogue composition**:
`packages/media-track/preview/{preview.svml,recipes.svs,build.svrun}` — "a wordless catalogue
composition … build.svrun renders the same composition". So a preview is reproducible, not a
hand-made mock. Studio (a local web editor, `packages/studio`) shows the surface preview as the
static recognition image for a lane (`packages/studio/src/surface-preview.ts`), and option pickers
render rich options (colour swatches, descriptions: `packages/studio/src/ui/main.ts:300`).

### How the agent is taught: one skill, many references

`skills/hypit/SKILL.md` (321 lines) is prose direction plus a **routing table**
(`SKILL.md:257`, ~55 rows: "When the question is about X → read `references/…/Y.md`"). The
references split three ways: `creation/` (brief, reference video, transformations),
`production/` (syntax and tools), `playbooks/` = **formats** (talking-head, short drama, podcast,
street interview, ranking, presenter-led explainer, narration-led) × **crafts** (captions, b-roll,
image/video/voice direction, sound mix, graphic composition, motion graphics). The repo symlinks the
same folder into `.claude/skills/hypit` and `.codex/skills/hypit`.

### "Skill from a reference video"

There is no command that emits a reusable style from a video. What exists is a **documented
analysis procedure** (`skills/hypit/references/creation/reference-video.md`) whose output is project
files the agent writes, then a clone workflow reuses:

1. `hypit media probe | boundaries | fetch` — metadata, abrupt-change detection, yt-dlp download.
2. `hypit transcribe --language en` — WhisperX word times.
3. `hypit media tile/tiles --transcript … --around "the phrase" --every-frame` — time-labelled
   grids with the words under each cell, paging dense passages; `frames`, `cut` for clips.
4. Write `ANALYSIS.md` (whole-piece model: why it holds attention, which visual systems persist)
   and `TIMELINE.md` (sections named by source time and phase, each system's entry/hold/exit tied to
   words — example at line 183), plus `BRIEF.md`, `TREATMENT.md`, `PROGRESS.md`.
5. Map each observed "system" to a component + recipe, or author a new project component.

The good part is the **method**, not tooling: read coarse, then narrow to every frame where a
transition happens; always read words and pictures together; describe a behaviour as states and
transitions; "a dimmer copy during an exit may be one object's fade"; separate what is visible from
what you infer.

### Rendering and review

Rendering is HyperFrames (HTML/CSS/JS) captured in headless Chromium, with a closed CSS allowlist
("Visual IR v1", `packages/visual-ir/src/style.ts:5`: "components cannot silently extend the
language by inventing another CSS property"; `backdrop-filter`, `filter`, `mix-blend-mode` are in it).
`hypit snapshot --studio <url> --start-frame … --grid 4x3` captures frames of the live Studio
composition without a new build (`references/production/snapshots.md`).

## 3. Good practices worth adopting

1. **Parameter docs that carry proportional design judgment.** `caption-fine/src/manifest.ts:99-130`
   states each effect's safe range *as a share of font size* and the visible failure past it. bay's
   tool/template variable descriptions state types and ranges; they should state "what looks wrong
   past this". Cheap, and it fixes the kind of slop agents produce (fat strokes, cloudy shadows).
2. **Every catalogue entry has a preview rendered from a checked-in source by the real renderer**
   (`packages/media-track/preview/preview.svml` + `build.svrun`). The preview cannot drift from the
   implementation because it is regenerated by it. bay should do this for templates, subtitle
   designs and style skills (§4b).
3. **Discovery answers with an example, not just a schema.** `hypit vocabulary <pkg>` prints an
   import line and a runnable example per surface (`video-cli/src/vocabulary.ts:297`). bay's
   `bay://guide/examples` is similar; extend it per style entry.
4. **Search from the role, not the name** (`references/production/vocabulary.md:6`): decide what
   the element does for the viewer before choosing a component. Belongs in bay's system prompt or
   `motion-graphics` skill verbatim-in-spirit.
5. **Closed vocabularies with versioned revisions** (Visual IR allowlist, 24-value caption-motion
   enum). bay already does this for `.brf` (`src/shared/brf.ts`); keep new style fields enums.
6. **Word-anchored timing.** Graphics follow named script spans, so a re-voice or trim re-flows
   them. bay has the parts (transcripts, `apply_script`, markers) but items are placed in frames.
   A `during: { words: "hair gel than trophies" }` placement resolved against the transcript at edit
   time would be the bay-shaped version (an idea, not code).
7. **Reference analysis as a written, resumable artefact** — `ANALYSIS.md` (why) and `TIMELINE.md`
   (what, when, tied to words), plus `PROGRESS.md` ("files are the memory", `SKILL.md:237`). bay's
   agent loses its reading when the session ends.
8. **"Evidence and reading" and "Done means watched"** (`SKILL.md:234`, `:249`): describe what a
   frame shows separately from interpretation; watch the actual deliverable before reporting done.
   Matches bay's `PROPOSE` rule; the explicit visible-vs-inferred split is worth adding.
9. **Money as a standing agreement** (`SKILL.md:213`): agree accounts, scope and budget once, record
   it, and ask again only past it. bay's generation tools price per call; a per-session budget the
   user sets would reduce prompts.
10. **Router skill + references instead of one huge prompt** (`SKILL.md:257`). bay's
    `bay://guide/*` resources are the same shape; the routing table phrased as "when the question is
    about X, read Y" is a better index than a flat list.

## 4. Integration proposals for bay

All of these are ideas re-implemented in bay's own code and words. **Copy no hypit files.**

### (a) A style catalog the agent can search and load

bay today: 15 hard-coded skills in `src/shared/skills.ts` (process skills: talking-head, captions,
launch-film…), 5 format guides (`bay://guide/format/*`), shipped templates (`add_template`,
`src/shared/templates.ts`), subtitle designs (`src/shared/subtitles.ts`), prompt kits.
What is missing is a *look* catalog: "kinetic-typography launch", "Apple keynote", "MrBeast
captions", "glass UI explainer".

Shape, fitted to bay:

- **Data:** `src/shared/styles/<id>.ts`, one file per style, `{ id, title, summary, tags[], formats[],
  appliesTo: ('captions'|'brf'|'composition'|'grade'|'pacing')[], body /* agent instructions */,
  params /* named design tokens: palette, type scale, motion timings, easing */, example /* a .brf
  or template call that is compiled and run in a test like brf-code.test.ts */, preview /* path */ }`.
  Generated index like `pnpm gen:tools` so two branches adding styles only conflict in generated files.
- **Tools** (new files in `src/shared/tools/`, read-only, no network):
  `search_styles({ query?, tags?, appliesTo? })` → ranked `{ id, title, summary, tags, previewUri }`
  (lexical over title/summary/tags is enough at <200 entries; SigLIP text embeddings from
  `src/main/vision/` could rank by a description later, locally);
  `read_style({ id })` → body, params and example. Loading a style is reading it — no install step.
- **Resources:** `bay://style/<id>` for the body, `bay://style/<id>/preview` for the image, listed in
  `resources/list` so clients without the tools still see them.
- **Skills stay user-invoked** (`CLAUDE.md`: "Skills are still user-invoked"). A style is data the
  agent may search on its own; a `/style` skill can wrap "search, show two previews, apply".
- **User styles:** a project/user folder under `<userData>/styles` read by main, text only, never
  executed (like `.brf` import). Treat bodies as untrusted text: same `pinText`-style escaping as
  asset names, since a shared style file is a prompt-injection vector.

### (b) Visual previews of styles in the agent panel

- Render previews **with bay's own engine from a checked-in source**, hypit-style: each style's
  `example` (a `.brf` module or template call) is rendered by a script (`preview_frame` path /
  exporter) to `resources/styles/<id>.webp` (a still) and an optional 2–3 s `.webm` loop.
  A test asserts every style has a preview newer than its source, like the MCP bundle-freshness
  gate — otherwise previews drift.
- **Panel:** when `search_styles` returns, the tool card renders a grid of preview tiles (the card
  already streams tool input; a result renderer keyed by tool name is the addition). Tiles come
  over `bay://` from the app bundle — local, no network, CSP unchanged. Clicking a tile inserts
  "use style <id>" into the composer; hovering plays the loop.
- **Live preview on the user's footage** is the better second step: `preview_frame` of the current
  frame with the style applied to a scratch copy (dry run), shown beside the static tile. That is
  something hypit's static PNG cannot do.

### (c) Creating a style skill from a reference video

bay has every analysis primitive hypit uses, locally:

| hypit | bay |
| --- | --- |
| `media fetch` (yt-dlp) | `import_url` (user's yt-dlp, consent dialog) |
| `media probe` / `boundaries` | `browse_assets`, `detect_cuts` |
| `transcribe` (WhisperX) | `transcribe` (local whisper, word times) |
| `media tile --transcript --around` | `frame_grid` with `assetId`, words under cells |
| `frames --every-frame` | `frame_grid` with a narrow range and high `count`; `preview_frame` |
| — | `detect_beats`, `find_highlights`, `index_footage`/`search_footage` |

Proposed flow, as a user-invoked skill `/style-from-reference` plus one write tool:

1. Import (or `import_url`); `detect_cuts` → shot list and cut rate; `detect_beats` → BPM, and
   what fraction of cuts land within ±2 frames of a beat; `transcribe` → words/min, pause lengths.
2. `frame_grid` coarse (1 cell/s over the whole piece), then fine grids around each cut and each
   graphic entrance (every frame over ~1 s) — hypit's coarse→fine method.
3. From the grids, the agent writes observations in fixed sections: palette (hex from frames),
   typography (weight, case, tracking, position on φ lines), caption system (words per group,
   active-word treatment, entrance), motion (entrance type, duration in frames, overshoot),
   transitions, grade, pacing numbers from step 1 — each tagged *observed* vs *inferred*.
4. `write_style({ id, title, summary, tags, body, params, example })` validates: `example` is run
   through `write_brf`'s whole-duration check; params fit the schema; then saves to
   `<userData>/styles` and renders the preview (§4b). Undo-able like any file write the agent makes.
5. Optionally keep `ANALYSIS.md`/`TIMELINE.md`-style notes on the project (a `notes` field or a
   sidecar) so a later session can resume.

Measured numbers (cut rate, beat alignment, WPM) should be computed by code, not estimated by the
model from grids. Name the one thing bay can't recover from a flattened video: exact fonts — say
"closest imported/available font" rather than claiming a match.

Licence: this is all idea-level; hypit's procedure text must not be pasted into a bay skill body.

### (d) Glass / blur / motion effects

hypit has little here: `backdrop-filter` is merely on the Visual IR allowlist, and the one use is a
12%-height `.glass` strip, `backdrop-filter: blur(9px); background: rgba(20,40,40,.15)`
(`examples/semantic-composition/packages/responsive-explainer/src/render.ts:45`). Its motion
contribution is the caption entrance enum (`zoom-blur`, `blur-in`, `stamp`, `spring`…) and the
motion-graphics craft page's principles ("direct the change, not just the entrance"; keep object
identity through a handoff).

For bay, glass cannot be CSS in the native path: `.brf` draws to the compositor's canvas, where
there is no backdrop. The honest implementation is a `.brf` node (e.g. `<glass blur tint radius>`)
that the compositor paints by blurring **the already-composited layers below** in the region —
the grade path (`engine/grade.ts`, one shared WebGL2 context) already does per-source GPU passes and
would host a two-pass Gaussian/Kawase blur. HTML compositions get `backdrop-filter` only over their
own content, not over the video underneath, because they are captured as separate layers — worth
stating in `bay://guide/composition/*` so agents stop trying. Caption `blur-in`/`zoom-blur` are
cheap wins for `src/shared/subtitles.ts` designs. All bay's own code; nothing to copy.

## 5. Things NOT to copy

1. **Any code, docs text, kits, recipes or preview images** — clause 1b (no commercial
   redistribution, including bundled in a product) plus share-alike and logo retention. bay ships
   to third parties. Ideas only, cited as bay already does.
2. **Hosted-model-first defaults.** The skill steers toward HypiHub and paid generation
   ("Hypit's strong production prior is to create the material", `SKILL.md`), with affiliate links.
   bay is an editor of the user's footage; generation is the fourth network exception, opt-in, with
   a user key. Don't import the "generate everything" prior.
3. **Rendering by screenshotting Chromium** (64 headless processes, a Chrome download to
   `~/.cache/hyperframes/chrome`, `provider-hyperframes-local/src/browser.ts:70`). bay moved motion
   graphics to native `.brf` precisely to avoid DOM capture cost; don't regress.
4. **Network in the analysis path.** hypit's WhisperX can be hosted, yt-dlp is bundled as a
   service, Chrome is downloaded at prepare time. bay: local whisper, the user's own yt-dlp behind a
   consent dialog, no downloads the user did not click. Style previews must ship in the bundle or be
   rendered locally — never fetched.
5. **A package-per-component ecosystem (~120 packages) and an npm-based component exchange.**
   bay's boundaries are a test (`src/shared/boundaries.ts`) over one tree, deliberately; and
   installing third-party code packages would put executable styles next to the agent. bay styles
   should be text/data plus sandboxed `.brf`.
6. **Prose-heavy, abstract skill writing.** `SKILL.md` is long on direction ("Bring the sensibility
   the video calls for… remain grounded, curious, imaginative") and uses many coined capitalised
   nouns (Take, Run, Candidate, Surface, Companion, Distribution, Recipe). It reads well to humans
   and costs tokens; bay's skills are numbered steps naming real tools — keep that.
7. **Cloning as the headline.** "Clone any viral video", "swap the host" and 100-variant ad
   generation invite copyright and likeness problems (the examples generate real footballers'
   likenesses). A bay style extracted from a reference should capture *treatment* (pacing, type,
   motion, grade), not reproduce someone's content or persona.
8. **Unverified claims in the README** ("100M views", "$1.15 total cost") — marketing, not evidence;
   nothing in the repo substantiates them. Don't cite them.
