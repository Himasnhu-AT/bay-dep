# Design

The visual system for bay.everholt.com. It exists so a page nobody has built yet already
looks like it belongs. If you are writing the words rather than the layout, read
[VOICE.md](./VOICE.md) as well.

The one rule: **the app is shown on its own ground, and read about on paper.** The site
has two surfaces and one accent. Night is the app's dark, and it is where the product
appears: the nav, the top of every page, the edit on the home page, a terminal line, the
footer. Paper is where you read. The orange is the app's own accent and is the only
colour that is not a neutral. If a change makes a page feel like a dashboard, or adds a
third ground, a second accent or a decoration that carries no information, it is wrong
even when it looks nice.

This replaced a printed-page system (cream paper, Fraunces, a brass accent, the editor
as a dark plate tipped into the page) on 2026-09-24, when the rebuilt plate made the
rest of the site look like a different product. What survived: the reading column and
its measure, rules drawn in from the left, one easing curve, the honesty rules, and the
plate itself.

## Surfaces

**Every page is bound in night.** The nav is night on every page and the footer is night
on every page, so paper is always something you are inside. Inner pages open on a band
of night that carries the page's label, `h1` and lead (`PageHeader`), then turn to paper
for everything below it. The home page stays on night from the nav through the hero, the
request, the edit and the before-and-after, turns to paper for the reading, and returns
to night for the close, which runs into the footer.

**Where night meets paper, the edge is hard and placed.** Never a gradient, never a fade.
On an inner page it is the bottom of the header band. On the home page it is the
**seam**: paper begins halfway down the before-and-after frame (`.seam` in
`globals.css`), so the one picture belongs to both grounds and the change of ground reads
as deliberate rather than as two blocks stacked. Anything after the frame inside that
section must be `relative` so it paints above the seam's paper.

**Night inside paper is allowed in one case: a line of the machine's.** `Command` is a
terminal line set on night. Nothing else on a paper page borrows the dark.

There is no system dark mode. The site already carries both grounds, each in a fixed
place; flipping them with the OS would put the reading on night and the app on paper.

## Tokens

Everything lives in the `@theme` block in `src/app/globals.css`. Use the Tailwind
utilities it generates. Do not write a hex value into a component.

### Colour

| Token | Value | Use |
|---|---|---|
| `paper` | `#f3f2ee` | The reading ground. A warm neutral, not cream: it sits beside the app's neutral greys. |
| `paper-raised` | `#fbfaf8` | The inside of a field. Nothing else. |
| `ink` | `#151513` | Headlines and anything read first, on paper. |
| `ink-soft` | `#45443f` | Body copy on paper. Most words on the site. |
| `muted` | `#6a6962` | Captions, the quiet clause of a headline, a field's edge. |
| `line` | `#dddbd4` | Rules on paper. Always 1px, never meaning-bearing. |
| `night` | `#0b0b0b` | The app's ground, one step below the app's own `#121212` so its window holds its shape on it. |
| `night-line` | `#262626` | Rules on night (the app's own hairline). |
| `on-night` | `#ededed` | Headlines on night (the app's primary ink). |
| `on-night-soft` | `#a1a1a1` | Body on night (the app's secondary ink). |
| `on-night-muted` | `#8a8a8a` | Captions and quiet clauses on night (the app's label ink). |
| `accent` | `#d9773f` | The app's accent, value for value. Buttons everywhere; text and marks on night. |
| `accent-hover` | `#e5874f` | A button under the pointer. |
| `accent-ink` | `#a4501c` | The same hue for text on paper: labels, links, marks. |

**One accent, and it is the app's.** The button is the accent on both grounds, with
night text on it. On night the accent may also be text (the page label, a link). On
paper the accent is never text; `accent-ink` is. Anything that is not a button, a link,
a page label or a small repeated mark (a status word, a feature's tool name) is a
neutral. A second accent is the answer to nothing.

**Emphasis is the second clause, not a colour.** A headline that has two parts sets the
second in the quiet ink (`Headline quiet=…`): "What went in, and what came out. *Drag the
line across the frame.*" This replaced the italic brass word. Nothing in a headline is
coloured.

### Type

One family: **Inter**, variable in weight and in optical size (`axes: ["opsz"]`), loaded
through `next/font` so nothing is fetched at runtime. It is the face the app draws its
interface in, so the site and the plate are one typeface. `font-optical-sizing: auto`
gives the display cut at large sizes by itself. The only other face is the app's own
monospace fallback (`font-app-mono`), for commands and tool names.

| Utility | Size | Weight | Tracking | Where |
|---|---|---|---|---|
| `text-display` | `clamp(44px, 6.6vw, 96px)` | 600 | -0.04em | The home `h1`. One per site. |
| `text-title` | `clamp(38px, 5.4vw, 68px)` | 600 | -0.035em | An inner page's `h1`. |
| `text-headline` | `clamp(28px, 3.4vw, 44px)` | 600 | -0.025em | A section's `h2` (`Headline`). |
| `text-quote` | `clamp(24px, 3vw, 36px)` | 600 | -0.02em | The closing statement (`PullQuote`). |
| `text-lead` | `clamp(18px, 1.9vw, 22px)` | 400 | -0.012em | The paragraph under an `h1` or a headline. |
| `text-section` | 21px | 600 | -0.012em | A row or block title (`h2`/`h3`). |
| `text-eyebrow` | 13px | 600 | 0 | The page label, sentence case, in the accent. |

Body is Tailwind's `text-base` (16px, 1.6). Captions are `text-sm` or `text-xs`. Tracking
tightens as size grows and is never set on small text; there is no uppercase, spaced-out
label anywhere on the site. Weight does the emphasis: 600 for headings, 500 for
buttons, links and labels, 400 for reading. Line length is capped at `60ch` for body,
`56ch` for leads, and headings are `text-balance`.

**One label per page.** The `Eyebrow` sits over the `h1` and nowhere else. A section is
opened by its `Headline` (or, for a small block, a `text-section` `h2`), not by a caps
label over a smaller title.

### Space

- The column is `max-w-page` (1080px) with `px-5` gutters on a phone and `px-8` from
  `sm`. The `Wrap` component is the only thing that should apply it.
- **One thing is allowed outside the column: the plate.** It runs to 1560px because it
  carries a conversation and an editor at once. The hero frame and the before-and-after
  stay in the column.
- A page header band is `pt-16 pb-16`, `sm:pt-24 sm:pb-24`. The first block on paper under
  it is `mt-16`. Sections on paper are `mt-24` apart; a headline to its list is `mt-10`.
- Rows are `py-8`, `sm:py-10`. The home page's night sections are `pt-28`, `sm:pt-36`.

Prefer these numbers over inventing new ones.

### Shape

**12px corners on every surface, full round on every button.** The hero frame, the
plate's window, the before-and-after frame, `Command` and `Field` are `rounded-[12px]`.
`ActionLink` and `ActionButton` are pills. Rules have no corners. No shadows anywhere:
the grounds are flat, and a surface is separated by its edge or by the ground changing.

## The hero

The home page opens on night with the label, the headline, one sentence, the button and
a secondary link to `/status`, and nothing else: no image. The first picture of the app is
the pinned sequence directly below, which starts at the first scroll. (The owner removed a
hero frame and a separate "here is that edit, being made" introduction on 2026-09-24: the
sequence introduces itself.)

## The plate

The editor as it appears on the page, in `src/components/app/`. `AppPlate` draws one frame
of the figure from a step index, `AgentPanel` draws the agent panel down its left side, and
`ScrollSequence` decides which step. `BeforeAfter` is the figure after it (see below).

**The plate is the app's window, as it is today.** It is re-created from the current
source, not from memory and not from a screenshot: the layout in `../src/renderer/src/App.tsx`
(top bar; icon rail, side panel, preview over transport, inspector; timeline; status bar),
the sizes in the editor components (44px top bar and rail, 148px track header, 26px ruler,
58px video and 46px audio tracks, 36px transport, 24px status bar), and the labels as the
app prints them, down to `Nothing on the timeline yet`, `Unsaved changes`, `Add track`,
`Show all 11` and the inspector's section names. The icons are the app's own, from
`lucide-react` at the app's version. When the app's layout changes, this changes with it.

**The conversation is inside the window because the app now has one.** The agent panel is
the app's side panel: your message in a bubble on the right, the agent's prose under it, one
card per tool call with a check when it returns, and, at the end of a turn that changed the
project, the Changes card with its Revert. The log fills from the top and, once full, keeps
its newest entry in view the way the panel scrolls. That is done in CSS (a column pushed up
by an auto margin while it fits, aligned to the bottom once it overflows), so no script
measures anything and the no-script figure reads the same. The newest entry is the only one
at full strength; older ones sit at 75%, which keeps `ink-1` text at about 4.5:1.

**The chrome is drawn; the pictures are real.** The edit on the plate was made in the
current app (2026-09-24): four Pexels clips (`CREDITS.md`) and two generated sound beds, cut,
graded, keyframed, dissolved and mixed by calling the app's tools, then exported with
loudness mastering. The preview shows frames the app itself rendered at each state of that
edit (`public/plate/still-*.avif`, exported one frame at a time while walking the undo history
back), and the video clips carry filmstrips of their source ranges (`strip-*.avif`), because
the app's clips do. About 190 KB of AVIF in all, loaded lazily.

**What the plate must keep true.** Every tool name in the panel is one in
`../src/shared/tools`, in the order the real edit called them, and each changes the editor
the way that call did: the clips, their frames, the grades, the inspector values, the
warnings the agent answered, the change list and the export result are that session's. Two
shortenings, both stated in the caption: paths and ids are shown by name, and the export's 36
progress polls are shown as two. The agent's sentences were written for the session, and the
caption says so. Nothing on the plate is an affordance the app lacks: there
is no cursor, because the agent has none, and no progress bar on the agent's export, because
the panel shows none; the export's progress is what the agent itself reads back from
`track_export`. The repository's `pnpm test` holds the two checkable claims:
`src/shared/website-plate.test.ts` fails when a tool the plate shows leaves the catalog, or
when a plate colour stops matching the app's.

**The palette is not ours.** Every value is copied from the dark theme in
`../src/renderer/src/styles.css` and lives in the `@theme` block as `--color-app-*`, under
the app's own token name. Do not tune them to taste. The site's own night tokens
(`on-night`, `night-line`, `accent`) share several of these values on purpose, but are
separate tokens: the `app-*` set follows the app, and the test holds them to it.

| Token | Value | The app's role |
|---|---|---|
| `app-surface-0` … `app-surface-4` | `#121212` `#181818` `#212121` `#2a2a2a` `#333333` | ground, panel, control, hover, pressed |
| `app-ink-0` … `app-ink-3` | `#ededed` `#a1a1a1` `#8a8a8a` `#4a4a4a` | primary, secondary, labels, disabled |
| `app-line` / `app-line-strong` | `#262626` / `#333333` | hairlines between panels / control outlines |
| `app-accent` | `#d9773f` | the one brand colour: selection, keys, the active rail page |
| `app-playhead` | `#f5f5f5` | the playhead |
| `app-success` | `#3dba7e` | the `+` of an added change |
| `app-on-media` | `#e8eaed` | text on a clip |
| `app-clip-video` / `-edge` | `#2c3a4a` / `#3d5166` | a picture clip and its border |
| `app-clip-audio` / `-edge` | `#25382f` / `#356047` | a sound clip and its border |
| `app-waveform` | `#5fd39a` | the waveform, at 45% as the app draws it |

**Type.** The plate's chrome is Inter, which the app draws its interface in and which is
now the site's only face. The app's monospace is JetBrains Mono, which the site does not load; the
plate uses the app's own fallback, the system monospace, rather than fetch a font for a
dozen tool names.

**The chapter notes have no numbers.** Each beat's note is its title and body only; the
accent rule under the plate that fills as the sequence advances says how far along you
are. `Chapter.eyebrow` is still in `src/lib/sequence.ts` as the chapter's key.

**The phone split.** Below `@5xl` the window stacks: top bar, preview and transport, the
timeline with a narrow header, then the agent panel at 27vh, with the rail, inspector,
composer and status bar left out. Each chapter carries a one-sentence `short` for phones.

**Breakpoints inside the plate are container queries, never viewport ones**, on the named
container `plate`. The plate sits in a column that is a fraction of the window, so a
viewport rule would hand a narrow plate the layout meant for a wide one.

**Nothing jogs.** The timeline has a fixed height, as its panel does, so a track arriving
takes empty room instead of growing the figure, and when the fifth track outgrows it the
lanes are scrolled up by a translate, as the app's panel would be scrolled. The inspector is
positioned, so its sections clip at the preview's height rather than stretching it, and
where the section a step is about (Grade, Transform, Audio & speed) sits below the fold it
is scrolled to by a translate.

## Before and after

`BeforeAfter`, under the sequence: the four clips as downloaded, cut to the same frames, and
the finished edit, in one 16:9 frame with a line you drag. It is the second figure and the
only other place the plate's colours appear (the frame's ground before a poster arrives).

- **Nothing is requested until it is near.** Two posters (AVIF with a WebP fallback, about
  30 KB each) are lazy images. The videos get their `<source>`s only within 600px of the
  viewport: AV1 first (about 630 KB and 690 KB), H.264 after (about 880 KB and 1 MB), both
  960×540, 18.9 s. They play muted and looped while a quarter of the frame is visible, pause
  when it is not, and under `prefers-reduced-motion` wait for Play.
- **The wipe is transforms only.** The after layer is a window translated right by the
  line's share of the width, with its picture translated back by the same amount; the line
  and its handle are translated with it. One custom property, `--p`, moves all three.
- **It tracks the pointer 1:1** from wherever you press on the frame, with pointer capture,
  and `touch-action: pan-y` so a vertical swipe still scrolls the page. The same control is
  a range input for the keyboard and screen readers (arrows, Home, End), which takes no
  pointer events and draws an accent focus ring inside the frame.
- **The two videos keep one clock.** The after video leads. On every animation frame while
  it plays (drawn or not, so the hidden side of a phone's toggle counts too), the before's
  offset from it, taken across the loop point, is corrected: past a quarter second by a
  seek, past half a frame by running the before up to 10% fast or slow, since a seek stalls
  it. A pause or seek of the after is copied to the before at once, and when either side
  runs out of data (`waiting`) the other is paused until both can play.
- **Labels are not laid over the picture.** In the wipe, which side is which is said in the
  caption under it; in the split, each frame has its label on the line above it (see below).
  "Hear the edit" unmutes the after video; nothing plays sound unasked.

**It is one component with two uses.** The home page passes `HOME_PAIR` and `seam`; `/compare`
passes one pair per entry in `src/lib/comparisons.ts`, always as a split. The props: `pair`
(each side's AV1 and H.264 `.mp4`, its AVIF and WebP poster, and its aspect, `16:9` or
`9:16`), `caption` (the line beside Play that says which side is which; the wipe needs it),
`notes` (anything more, in the `figcaption`), `layout`, `sides` (the split's quiet clause after
each label), `sound` (whether to offer "Hear the edit") and `label` (the control's name).

- **`layout="wipe"`** is the frame above, for a pair in one aspect. A `9:16` wipe is capped at
  78% of the window's height, centred in the column, so its bottom is on screen when its top is.
- **`layout="split"`** is two frames side by side from `sm`, at one height: each column's share
  is its aspect's width. **The whole pair fits one screen**, which is the point of it: the
  height is capped at `min(68svh, 560px)` and the row is never wider than that height allows,
  so at 1280×720 two vertical frames are 490px tall and a 16:9 pair is two 500px frames. Over
  each frame, not on it, its label: "Before" or "After" in `ink` at 600, then the quiet clause
  (`sides`) in `muted`, `text-sm`, sentence case like every label on the site. Under the pair,
  Play, "Hear the edit" and "How it was made" as text buttons.
  - **The notes move out of the pair's way.** With two vertical frames on a screen from `lg`,
    the `figcaption` stands beside the pair, always open. Otherwise it sits under the pair,
    closed, behind "How it was made" (`aria-expanded`), so the next figure is not pushed a
    screen further down.
  - **On a phone**, two 16:9 frames stack, labelled, and still fit. When either frame is
    vertical, both share one cell and a **toggle** picks the one shown: a 1px `line` pill
    holding two pill buttons, the chosen one `ink` with `paper` text (`aria-pressed`), the
    shown side's quiet clause beside it. The hidden side keeps playing at opacity 0, so
    switching is instant and on the same clock. This toggle is the only segmented control on
    the site; do not reuse it as a tab bar.

On `/compare` the figures are on paper, so there is no seam: each is opened by its title
(`text-section` `h2`) and the style's title and the length in `muted`. Its `figcaption` carries
`Prompt` (what it was told), `StepList` (what ran), a sentence on hand retouching and the
footage credits, in one column capped at `62ch`. Figures are separated by `Rule`.

The plate and the before-and-after frame have 12px corners and no shadow. The plate's
window is edged in `app-line-strong` (`#333`), one step lighter than the app's own
hairline, so it holds its shape on night, which is darker than the app's ground.

## Components

All of them are in `src/components/layout.tsx`, and they are server components. The
marketing pages have five client components and no more: `Reveal`, which needs an
observer, the nav, which needs the current path, `ScrollSequence`, which needs scroll
position, `BeforeAfter`, which needs a pointer and two videos, and `DepthFallback`, which
does nothing where CSS scroll timelines work. The
access pages (`/waitlist`, `/desktop/sign-in`, `/admin`) are server
pages around one client component each, in `src/components/access/`, because signing in
is interactive by nature.

```tsx
<main className="flex-1 pb-28">
  <PageHeader
    eyebrow="Status"
    title="What actually runs."
    lead="One paragraph. Two sentences, three at the outside."
  />
  <Wrap>
    <div className="mt-16">
      <Headline quiet="The second clause, in the quiet ink.">A section opens.</Headline>
    </div>

    <RuledList className="mt-10">
      <RuledRow aside={<span className="text-eyebrow font-semibold text-accent-ink">Built</span>} title="A row title">
        The body of the row. Plain sentences.
      </RuledRow>
    </RuledList>

    <Columns ruled className="mt-24">
      <Block title="What it will not do">The omission, stated.</Block>
      <Block title="Where it actually is">The limit, stated first.</Block>
    </Columns>

    <PullQuote>The line you want people to remember.</PullQuote>
  </Wrap>
</main>
```

- **`Wrap`** is the column.
- **`PageHeader`** is the night band at the top of an inner page: the label, the `h1` and
  the lead, with the reveal delays set. It sits outside the page's `Wrap`.
- **`Eyebrow`** is the page label: 13px, semibold, sentence case, `accent` on night and
  `accent-ink` on paper. One per page, over the `h1`. `tone="night"` on night.
- **`Headline`** opens a section: `text-headline`, with `quiet` for a second clause in the
  quiet ink. `tone="night"` on night.
- **`RuledList` / `RuledRow`** is the site's list: a left column for a status or a verb
  in `accent-ink`, and the substance on the right, rules drawn in between. `wide` when the
  left column holds a word longer than a status. It collapses below `sm`.
- **`MarkedGrid`** is four (or any even number of) notes in two columns, each headed by
  the thing in the app it is about, in monospace: `⌘Z`, `Revert`, `preview_frame`.
  Exactly as many cells as notes. Home page.
- **`Columns` / `Block`** is a pair of small titled blocks side by side from `md`.
  `Block` is the `text-section` `h2` and its body; it is also how a lone block opens,
  such as every page's "What it will not do".
- **`ActionLink`** is the site's button: a 48px pill in `accent` with night text on it
  (6.2:1), an arrow that nudges 4px, `scale(0.98)` while pressed. The same on both grounds.
  One per screen. **`ActionButton`** is the same for an action that is not a navigation
  (join, approve); `quiet` makes it an underlined word for the secondary action beside a
  primary one (Sign in with Google under the waitlist's join form, Sign out, Revoke), so
  a screen still asks for one thing. Disabled is `line` fill and `muted`
  text.
- **`TextLink`** is a link in running copy or beside a button: underlined, `accent-ink`
  on paper and `accent` on night, `arrow` for the secondary action next to an
  `ActionLink`.
- **`Field`** is a raised box (`paper-raised`) with a 1px `muted` edge (4.9:1, because the
  edge is what says "type here"), 12px corners, the label above it in `ink-soft`, and an
  `accent-ink` edge plus a soft accent ring on focus. `multiline` makes it a textarea;
  `hint` is a `text-sm` muted line below. Errors are not red: a sentence in `ink` ruled
  down its left edge in `accent-ink`, with `role="alert"`, that says what to do next.
- **`Command`** is a line you would actually type, set on night with 12px corners in the
  app's monospace, the `$` in the accent. The only night on a paper page. One command
  each; stack them with `space-y-2.5`.
- **`Prompt`** is the words a person gave the agent, verbatim: a `text-xs` `muted` label ("The
  prompt, verbatim") over a blockquote in `ink-soft`, behind a 1px `line` rule on its left,
  line breaks kept. It is a person's sentence, not the machine's, so it stays on paper and is
  never a `Command`. `/compare`.
- **`StepList`** is what ran, in order: one `text-sm` line per step, a tool's name in the app's
  monospace and `accent-ink` (the "feature's tool name" mark above), the rest in `ink-soft`.
  `/compare`.
- **`PullQuote`** is the closing statement, set at `text-quote` in `ink`, at most one per
  page.
- **`AppPlate` / `AgentPanel` / `ScrollSequence`** are the figure, its agent panel and the
  scroll driver, home page only; **`BeforeAfter`** is the comparison under it, and every
  figure on `/compare`.
- **`Reveal`** wraps anything that should arrive when it is scrolled to.
- **`Rule`** is a standalone 1px line that draws itself in from the left.

If you find yourself needing a card, a shadow, a gradient, a glow, a third ground or a
second accent, the answer is almost certainly a `RuledRow`, a `Block`, or nothing.

## Motion

**Things arrive, and rules are drawn.** A rule is never faded in; it is drawn from the
left at the moment its content arrives. Everything else is a quiet arrival or a change of
depth as you scroll. Transforms and opacity only, always.

One curve, `--ease-paper`, which is `cubic-bezier(0.16, 1, 0.3, 1)`. It decelerates hard,
so motion reads as a confident arrival rather than a slide. No bounce, no elastic, ever.

Four behaviours, and no fifth without amending this section:

**Arrival** (`Reveal`, default). Opacity 0 to 1 and 14px up, 0.7s. Applied to any block of
content that should announce itself once.

**Settle** (`Reveal variant="settle"`). The same, from 24px, over 1s. This is the home
headline, and it should stay the only place on the site that uses it. A focal moment
repeated on every page is not a focal moment. (It was a blur until 2026-09-24; a filter is
not a transform, so it went.)

**Rule** (`data-rule`). `scaleX(0)` to 1 from the left origin, 0.8s, starting 0.08s after
the content it belongs to, so the line lands just behind the words. Used by `RuledList`,
every `RuledRow`, and every `MarkedGrid` note.

Nothing loops. The hero's scroll cue and its looping nudge went with the printed-page
system: the frame rising under the headline is the reason to scroll, and a label that says
so is noise.

**Depth** (`data-depth`). The one scroll-linked motion besides the sequence, added at the
owner's request: layers of one page moving at different rates as you scroll past them.
Three kinds, all in `globals.css`:

- `peel`, the home hero. Each line rises faster than the page by `--depth` of the scroll
  over the first screen (label 0.14, headline 0.10, lead and actions 0.06) and
  fades toward `--fade`. Upper lines move faster than lower ones, so they separate as they
  leave rather than colliding, and the bottom of the hero moves with the page so it never
  runs into the section under it.
- `enter`, a plate arriving. It starts `--enter` (6vh) below its place and settles as its
  `[data-depth-root]` finishes entering, so the plate reads as set into the page. The
  note above it moves with the page. In the pinned sequence it settles exactly as the
  plate pins; in the stacked fallback each plate does it once.
- `lift`, the home hero's frame. It grows from `--lift` (0.92) to full size over the first
  70vh of scroll, from its top edge, so the picture comes forward as the words above it
  leave. `scale`, on the compositor. (The old `drift` on the home page's numerals went
  with the numerals.)

How it is built, which is the part to keep: CSS scroll-driven animations
(`animation-timeline: scroll()` / `view()`) of `translate`, `scale` and `opacity` only, which the
browser runs on the compositor with no script and no layout. Where they are unsupported,
`DepthFallback` reproduces the same curves from one passive, rAF-throttled listener that
reads every rectangle before writing any `translate`. Nothing starts hidden; every
from-state is visible and a few pixels off its place. `prefers-reduced-motion: reduce`
switches all of it off in both paths. Measured with a scrolling frame probe at 1440×900
on 2026-09-24 (the dev server, 16px per frame over the whole home page): at 1× every one
of 1042 frames was 16.7ms; at 4× the median held at 16.7ms and 45 frames reached 33ms,
every one of them at a step boundary inside the pinned sequence, where the plate
re-renders for its new step. Nothing outside the sequence dropped a frame. Keep that true: never animate `top`, `margin`, `height` or `width` from scroll,
and never add a depth that makes one element pass over another.

### Scroll

Reveals fire when the element is actually scrolled to, once, through an
`IntersectionObserver` in `Reveal` (8% visible, 6% bottom margin). Nothing below the fold
plays its entrance before anyone has seen it. An entrance that has already finished by the
time the reader arrives is worse than no entrance, because the page then simply looks
static to them.

`scroll-behavior: smooth` is set on `html`, together with `data-scroll-behavior="smooth"`
so Next does not warn about route transitions.

There is one scroll-linked sequence, `ScrollSequence` on the home page, and no other. It
pins the plate and advances it through six beats as the reader scrolls. The rules it lives
under, which any future sequence inherits:

- **Scroll drives one integer, not a render loop.** The listener is passive, throttled to
  an animation frame, and sets a step index. Everything visible is a CSS transition or a
  one-time arrival off that index, so scrolling never re-renders the plate per frame.
- **One thing is continuous: the playhead.** It is the only motion tied to the scroll
  position itself, because a playhead that jumped would not read as time. Its path is
  written from the sequence at build time (`playheadKeyframes` in `src/lib/sequence.ts`)
  as a keyframe animation of `translate`, run on the pinned section's view timeline
  (`--depth-root`, range `contain`). Within each step's band it travels to that step's
  frame over the first 60% of the band and then holds, so it moves while you scroll and
  rests while you read. Where scroll timelines are missing, `ScrollSequence`'s handler
  moves it from the same curve (`playheadAt`), so the two cannot drift apart.
- **Four arrivals, each played once when a step brings its element.** `plate-in` (an entry
  in the panel, a track, an inspector section: 6px up, 0.45s), `plate-land` (a clip set
  down on its lane: 8px of fall, 0.35s), `plate-key` (a keyframe diamond grown from its
  point, 0.4s, 70ms apart) and `plate-wave` (the waveform opening from its centre line,
  0.7s, after the clip lands). All on `--ease-paper`, all `translate`, `scale` or
  `opacity`, all off under `prefers-reduced-motion`. Changes of state inside the reel
  (the canvas turning vertical, the chart being rewritten) are cross-fades between layers.
- **The static state is the real one.** Pinning is switched on after mount whenever motion
  is allowed and the window is at least 640px tall. Width is not the test: a phone reads
  the sequence as well as a laptop. Height is, because a figure taller than the window
  would have its bottom cut off. With no script, on a narrow screen, or under
  `prefers-reduced-motion`, every chapter renders stacked, each with its own figure at the
  state that chapter leaves the editor in. The fallback tells the whole story rather than a
  truncated one.
- **No autoplaying video, no scroll hijacking.** The page never fights the reader's scroll
  or changes its speed. Content only ever advances. Depth (above) moves things relative to
  one another; it never moves the page.

Stagger is only for siblings that genuinely appear together, which now means the page
header (0.05s, 0.14s, 0.24s) and the home hero sequence. Rows are not staggered as a list
any more, because scrolling already sequences them; they carry `Math.min(i, 3) * 0.06`
purely to soften the two or three that share the first screen.

### Feedback

Hover and focus are 200ms to 300ms on the same curve. Nav links draw a 1px accent rule
underneath, the same gesture as the page rules, rather than only changing colour. The
button lightens to `accent-hover`, nudges its arrow 4px, and presses to `scale(0.98)` on
pointer-down, not on release. Rows are not interactive, so they have no hover state.

### Safety

The hidden pre-state lives inside `@media (scripting: enabled)` in `globals.css`. If
scripting is off, or the browser does not know that query, none of it applies and the page
renders fully visible. No content on this site can be hidden by a script that failed to
run, and there is no inline script to make it so.

`prefers-reduced-motion: reduce` clears every transform and transition, and turns
smooth scrolling off. Use `Reveal` and `data-rule` rather than hand-rolling motion and
this keeps holding.

## Accessibility

Measured against paper (`#f3f2ee`):

| Colour | Ratio | Verdict |
|---|---|---|
| `ink` | 16.3:1 | Passes AA and AAA at any size. |
| `ink-soft` | 8.7:1 | Passes AA and AAA at any size. Body copy lives here. |
| `muted` | 4.9:1 | Passes AA at any size. Also a field's edge. |
| `accent-ink` | 5.0:1 | Passes AA at any size. Labels and links on paper. |
| `accent` | 2.8:1 | Never text on paper. It is the button's fill, and the text on the button is night. |
| `line` | 1.2:1 | Decorative rules only. Never a border that carries meaning. |

Measured against night (`#0b0b0b`):

| Colour | Ratio | Verdict |
|---|---|---|
| `on-night` | 16.8:1 | Passes AA and AAA at any size. |
| `on-night-soft` | 7.6:1 | Passes AA and AAA at any size. Body on night. |
| `on-night-muted` | 5.7:1 | Passes AA at any size. Captions, quiet clauses. |
| `accent` | 6.2:1 | Passes AA at any size. The page label and links on night. |
| night on `accent` | 6.2:1 | Passes AA at any size. The button's label (7.4:1 on `accent-hover`). |

If you retune the palette, re-measure: the ratio is `(L1 + 0.05) / (L2 + 0.05)` on
relative luminance, and getting it wrong is invisible to you and not to the person
reading it.

Measured against the app's panel (`app-surface-1`, `#181818`) and its controls
(`app-surface-2`, `#212121`), which is where these appear:

| Colour | On panel | On control | Verdict |
|---|---|---|---|
| `app-ink-0` | 15.2:1 | 13.8:1 | Passes AA and AAA at any size. |
| `app-ink-1` | 6.9:1 | 6.2:1 | Passes AA at any size. The agent's prose. |
| `app-ink-2` | 5.1:1 | 4.7:1 | Passes AA at any size. Labels and hints. |
| `app-accent` | 5.6:1 | 5.1:1 | Passes AA at any size. |
| `app-on-media` on `app-clip-video` | 9.6:1 | | Passes AA at any size. |
| white on `app-accent` | 3.2:1 | | Fails AA for the 12px Export label. |

The last row is the app's own Export button (`accent-ink` on `accent`), copied faithfully:
the plate does not correct it, because a plate that looked better than the app would be
the dishonest kind of re-creation. It is recorded here and reported to the app, which is
where it should be fixed; when it is, the token test brings the plate along.

Other standing rules:

- Focus is a 2px accent outline with 3px offset, set globally. Do not remove it.
- Nav links stay visible at every width. The original designs hid them below 640px,
  which leaves a phone with no way to move around the site.
- One `h1` per page, `h2` for sections and blocks, `h3` for rows and notes, in order.
- Decorative arrows and rules get `aria-hidden`.

## Adding a page

1. `src/app/<name>/page.tsx`, exporting `metadata` with a `title` and a `description`.
   The title template in `layout.tsx` appends the product name, so pass "Status" on its
   own rather than repeating the product name in it.
2. Open with `<main className="flex-1 pb-28">`, a `PageHeader`, then a `Wrap`.
3. Build the page out of the components above. If the page needs a shape that does not
   exist yet, add it to `layout.tsx` and document it here in the same commit, so the next
   page inherits it instead of reinventing it.
4. Content that repeats or grows goes in `src/lib/`, not inline in the page.
5. Read [VOICE.md](./VOICE.md) before writing the words.

## Adding a comparison

1. Keep the run's `.bay`, its tool log and the exported file. The raw and the edit must be one
   length and cut on the same frames.
2. `scripts/encode-compare.sh <slug> <before.mp4> <after.mp4>` (add `--before-audio` if the raw
   keeps its sound). It writes `public/compare/<slug>/`, prints each file's size, refuses any
   over 8 MB and prints `durationSec`. Its header says which encoders it needs.
3. In `src/lib/comparisons.ts`, fill the entry from the run (the fields are documented at the
   top of the file) and set `status: "ready"`. Add its footage to `CREDITS.md`.
4. `pnpm build` refuses a ready entry with the pending prompt, no steps, no length, a wipe across
   two aspects, a credit missing a field, or a missing media file, and names which.
