# Design

The visual system for bay.everholt.com. It exists so a page nobody has built yet already
looks like it belongs. If you are writing the words rather than the layout, read
[VOICE.md](./VOICE.md) as well.

The one rule: **the page should look like a printed page, not an app.** Paper, ink, one
metal accent, a lot of empty space, and rules where a book would put rules. If a change
makes the site feel more like a dashboard, it is wrong even when it looks nice.

**The one exception is the plate.** A printed book does not become a dashboard because it
carries a tipped-in plate, and neither does this site. The editor may appear on the page
as a dark rectangle set into the paper, in the app's own colours, provided it is a
faithful re-creation of the real interface and is captioned as one. See
[The plate](#the-plate). Nothing else on the site may borrow those colours: they are the
app's, and outside the plate they are simply a second theme, which this site does not
have.

## Tokens

Everything lives in the `@theme` block in `src/app/globals.css`. Use the Tailwind
utilities it generates. Do not write a hex value into a component.

### Colour

| Token | Value | Utility | Use |
|---|---|---|---|
| `--color-paper` | `#f5f1e8` | `bg-paper` | The page. There is no second background colour. |
| `--color-ink` | `#16130d` | `text-ink` | Headlines, wordmark, anything that must be read first. |
| `--color-ink-soft` | `#4a4438` | `text-ink-soft` | Body copy and nav links. Most words on the site. |
| `--color-muted` | `#6f6857` | `text-muted` | Eyebrows, footer, marginal notes. |
| `--color-brass` | `#9a7b3f` | `text-brass` | The accent, at display sizes only. |
| `--color-brass-deep` | `#806331` | `text-brass-deep` | The same accent for anything under 24px. |
| `--color-line` | `#d9d1bf` | `border-line` | Every rule and divider. Always 1px. |

**The brass rule: one idea per screen wears the accent.** On a page that means the
italic word in the headline, plus the small structural marks that repeat (the numerals on the home page, the state labels on the status page). Brass on a whole paragraph,
or on two competing headlines, spends the only emphasis the palette has.

**Two brasses, by size.** `brass` is the headline colour and the colour of the short rule
under the hero. Anything smaller than 24px that is made of words takes `brass-deep`: nav
active states, status labels, numerals. The hue reads as the same accent; the darker one
is legible at 11px, which the lighter one is not. See the contrast table below.

There is no dark mode and no second theme. Paper is the brand.

### Type

Two families, loaded through `next/font` so nothing is fetched from Google at runtime.

- **Fraunces** (`font-serif`) for headlines, section titles, leads, numerals, and pull
  quotes. Weight 300 for anything large, 400 for section titles. Italic carries emphasis.
- **Inter** (`font-sans`) for body copy, nav, labels, and buttons. Weights 400 and 500.

Six sizes, and every piece of text on the site is one of them:

| Utility | Size | Where |
|---|---|---|
| `text-eyebrow` | 11px, `0.28em` tracking, uppercase | The label above a headline. |
| `text-display` | `clamp(44px, 7.4vw, 92px)` | The home headline. One per site. |
| `text-title` | `clamp(40px, 6vw, 72px)` | The `h1` of an inner page. One per page. |
| `text-lead` | `clamp(18px, 2.1vw, 23px)` | The serif paragraph under an `h1`. |
| `text-section` | 26px | `h2`, meaning a row title. |
| `text-quote` | `clamp(20px, 2.6vw, 28px)` | The closing italic line. |

Body copy is the Tailwind default `text-base` in `text-ink-soft`. Line length is capped
at `60ch` for body and `56ch` for leads and quotes, because a 1080px column of unbroken
prose is unreadable and the caps are what make the layout feel typeset.

### Space

- The column is `max-w-page` (1080px) with `px-8` gutters. The `Wrap` component is the
  only thing that should apply it.
- **One thing is allowed outside the column: the figure.** It runs to 1560px because it
  carries a conversation and an editor at once, and at 1080px neither is readable. This is
  the only exception on the site, and widening anything else to match it is how a page
  loses its measure.
- Inner pages open with `pt-24 pb-28`. The home page is a centred hero instead.
- The gap between the page header and the first rule is `mt-[82px]`. Rows are `py-11`
  on desktop and `py-9` below `sm`.
- A closing pull quote sits `mt-20` under the last rule.

Prefer these numbers over inventing new ones. The rhythm is more valuable than any
individual measurement being perfect.

## The plate

The editor as it appears on the page, in `src/components/app/`. `AppPlate` draws one frame
of the figure from a beat index; `AgentChat` draws the conversation down its left side;
`ScrollSequence` decides which index.

**One step reveals one line.** The log fills from the top and rolls once it is full, and
the newest line is the only one at full strength. Everything older sits at 55%, because the
reader is being asked to connect one line to one change in the editor.

**The figure has two panes because the product does.** The chat is your own client and the
editor is the app, and the claim the page makes is about the seam between them. Showing
one without the other leaves a reader guessing which half they are looking at. The chat is
positioned rather than in flow, so a long log clips inside the figure instead of stretching
it: the editor decides how tall the figure is.

Your own turn is not in the log. It sits on the page above the figure, in the paper voice,
because the words you type are yours and the log is the machine's. It is a
re-creation first built from the Rust UI's `bay-ui` crate (deleted; at the
`rust-engine-final` tag), never a screen capture, and the caption
under it says so. That caption is not decoration: it is the only thing separating an
honest demonstration from a claim the app is further along than it is.

**The palette is not ours.** Every value is copied from `theme.rs` and lives in the
`@theme` block as `--color-app-*`, plus `--color-elem-*` for the per-kind clip fills from
`element_color`. If the app's theme changes, these change with it. Do not tune them to
taste, and do not use them outside the plate.

| Token | Value | Source |
|---|---|---|
| `app-bg` | `#0f0f14` | the window ground |
| `app-panel` | `#16161d` | toolbar, media, inspector, timeline |
| `app-panel-alt` | `#1d1d26` | buttons and the scene bar |
| `app-lane` | `#121218` | a timeline lane |
| `app-border` | `#2a2a36` | every divider in the plate |
| `app-text` | `#e7e7ee` | labels and values |
| `app-muted` | `#8a8a9a` | secondary labels |
| `app-accent` | `#5b8cff` | playhead, chip, selection |
| `app-selected` / `app-selected-border` | `#2d3a66` / `#8fb0ff` | the selected clip and scene |
| `elem-video` / `elem-image` / `elem-text` / `elem-audio` | `#33628f` / `#7a4f95` / `#8f6a33` / `#2f8f63` | `element_color` |
| `elem-shape` | `#444455` | `element_color`'s fallback, which is what a shape takes |
| `reel-ground` / `reel-track` | `#0e0e12` / `#606070` | the reel inside the plate, from `reel-recipe.md` |

The element fills are named `elem-` and not `clip-` for a reason worth keeping:
`--color-clip-text` generates `bg-clip-text`, which is already a Tailwind utility for
`background-clip`. The core utility wins, so every Text clip renders unfilled and nothing
errors. Check any new token against Tailwind's own utility names before adding it.

`reel-track` is used at full opacity. The recipe measured `#606070` at 3.12:1 against the
reel's ground and recorded that alpha defeats the measurement, so a faded track would
reproduce the exact defect the recipe exists to warn about.

The plate renders in `font-app`, the system UI face, because that is what the app is drawn
in on the machine. It is deliberately not Inter and never Fraunces: the plate is a
different object from the page it sits on, and the type is what says so.

**What the plate must keep true.** The panel order is the app's: toolbar, scene bar, then
media, preview and inspector side by side, then the timeline. Clips never overlap within a
lane, because a lane holds one clip at a time. Disabled buttons are disabled for the real
reason, which is that nothing is selected or there is nothing to undo. Labels are the
app's strings, down to `+ Text`, `＋ Scene`, `SCENES` and `Select a clip to inspect it.`

**The chip is not a narrator.** `● Claude · <tool>` is raised by the planner's
`Planned::Tx` label, so only tools that return commands raise it. `project_create` is
answered by the shell before a project is open; `snapshot` and `render` return before the
planner because they produce a file. Those beats show what the app really shows, which for
`snapshot` is the status line `Claude snapshotted {at:.2}s`. Putting a chip on a beat that
would not raise one is the easiest lie on this site to tell and the hardest to notice.
Every tool name must appear in the catalog the plate was drawn from, `docs/native/mcp.md`,
which is historical: it went with the Rust engine (`git show rust-engine-final:docs/native/mcp.md`).
The plate, its chip and its status line re-create the Rust-era UI; the current app's tool
catalog is `../src/shared/mcp.ts`, and its agent reports each turn's changes in a Changes card
with a Revert rather than a chip.

The status line sits in the toolbar before Save, not under the timeline, and only when the
app has something to say. Its formats are the app's: `Saved to`, `Exported frame to`,
`Exported video to`, `Claude snapshotted`.

**The phone split is roughly half editor, a quarter log.** The preview and the log are
sized in `vh` below `@md`, so the proportion holds on any handset: about 49% of the screen
to the editor, 26% to the conversation, 16% to the chapter note. A full paragraph, a 60%
editor and a 30% log do not fit in one portrait screen together, which is why each chapter
carries a one-sentence `short` used below `sm`. The long body is still the one desktop
reads, and the stacked fallback reads it at every width.

**The figure stacks on a phone.** Above `@5xl` the conversation sits to the left of the
editor; below it the same two panes stack, editor first and log under it, so the thing the
sequence is about is the thing you see first. The reel inside the preview sizes itself in
`cqw` against its own frame, because that frame is a fraction of its desktop size on a
phone and fixed pixel type would spill straight out of it.

**Breakpoints inside the plate are container queries, never viewport ones.** The plate
lives in a grid column roughly 720px wide inside a 1080px page, so a `xl:` rule would hand
it the button set meant for a 1280px window and clip whatever sits at the end. Undo, redo
and the chip sit outside the toolbar's mask so they can never be the thing that clips.

The plate is ruled along its top edge in brass and casts no shadow. It is a leaf bound
into a printed page, not a window floating over one, and a drop shadow is the one gesture
that would make the page read as a dashboard.

## Components

All of them are in `src/components/layout.tsx`, and they are server components. The site
has three client components in total and no more: `Reveal`, which needs an observer, the
nav, which needs the current path, and `ScrollSequence`, which needs scroll position.

```tsx
<main className="flex-1 pt-24 pb-28">
  <Wrap>
    <PageHeader
      eyebrow="What we make"
      title={<>One app, <em className="text-brass italic">one job</em>.</>}
      lead="One serif paragraph. Two sentences, three at the outside."
    />

    <RuledList>
      <RuledRow aside={<span>I</span>} title="A row title">
        The body of the row. Plain sentences.
      </RuledRow>
    </RuledList>

    <PullQuote>&ldquo;The line you want people to remember.&rdquo;</PullQuote>
  </Wrap>
</main>
```

- **`Wrap`** is the column. Nothing sits outside it.
- **`Eyebrow`** is the caps label. Use it to open a page or a late section.
- **`PageHeader`** is the label, the `h1`, and the lead, with the reveal delays already
  set. Pass `title` as JSX so one word can be brass and italic.
- **`RuledList` / `RuledRow`** is the site's only list style: a narrow left column for a
  numeral, a status, or another marginal note, and the substance on the right. Pass
  `wide` when the left column holds a status and a kind rather than a numeral. It
  collapses to one column below `sm`.
- **`Command`** is a line you would actually type. The only monospace on the site, ruled
  down its left edge in brass on a slightly deeper paper rather than boxed in a shadow,
  so it reads as a line from a terminal and not as a widget. One line each; if you want
  a block of them, stack `Command`s with `space-y-2.5` so each stays a discrete
  instruction.
- **`PullQuote`** closes a page. At most one, and only when the line earns it.
- **`AppPlate` / `AgentChat` / `ScrollSequence`** are the figure, its conversation pane,
  and the scroll driver. Home page only.
- **`Reveal`** wraps anything that should arrive when it is scrolled to.
- **`Rule`** is a standalone 1px line that draws itself in from the left.

If you find yourself needing a card, a shadow, a gradient, a rounded corner larger than
1px, or a second accent colour, the answer is almost certainly a `RuledRow` instead.

## Motion

**The gesture is ruling a line on paper.** A rule is never faded in; it is drawn, from the
left, at the moment its content arrives. Everything else on the site is a quiet arrival
underneath that one idea. If a proposed animation cannot be described as something that
happens to paper or ink, it does not belong here.

One curve, `--ease-paper`, which is `cubic-bezier(0.16, 1, 0.3, 1)`. It decelerates hard,
so motion reads as a confident arrival rather than a slide. No bounce, no elastic, ever.

Three behaviours, and no fourth without amending this section:

**Arrival** (`Reveal`, default). Opacity 0 to 1 and 14px up, 0.7s. Applied to any block of
content that should announce itself once.

**Settle** (`Reveal variant="settle"`). The same, from 20px and `blur(5px)`, over 0.9s. Ink
resolving into paper. This is the home headline, and it should stay the only place on the
site that uses it. A focal moment repeated on every page is not a focal moment.

**Rule** (`data-rule`). `scaleX(0)` to 1 from the left origin, 0.8s, starting 0.08s after
the content it belongs to, so the line lands just behind the words. Used by `RuledList`,
every `RuledRow`, and the short brass rule under the home hero.

**Nudge** (`data-nudge`). The one looping animation on the site, on the hero's scroll cue:
a 2.1s fall and return. A cue that plays once is missed by anyone who was still reading the
headline, which is the whole audience it exists for. It is scoped to
`@media (scripting: enabled)` and cleared under `prefers-reduced-motion`. Do not add a
second loop anywhere; a page with two things moving forever has no focal point.

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
  an animation frame, and sets a beat index. Everything visible is a CSS transition off
  that index, so scrolling never re-renders the plate per frame.
- **The static state is the real one.** Pinning is switched on after mount whenever motion
  is allowed and the window is at least 640px tall. Width is not the test: a phone reads
  the sequence as well as a laptop. Height is, because a figure taller than the window
  would have its bottom cut off. With no script, on a narrow screen, or under
  `prefers-reduced-motion`, every chapter renders stacked, each with its own figure at the
  state that chapter leaves the editor in. The fallback tells the whole story rather than a
  truncated one.
- **No parallax, no autoplaying video, no scroll hijacking.** The page never fights the
  reader's scroll or changes its speed. Content only ever advances.

Stagger is only for siblings that genuinely appear together, which now means the page
header (0.05s, 0.14s, 0.24s) and the home hero sequence. Rows are not staggered as a list
any more, because scrolling already sequences them; they carry `Math.min(i, 3) * 0.06`
purely to soften the two or three that share the first screen.

### Feedback

Hover and focus are 200ms to 300ms on the same curve. Nav links draw a 1px brass rule
underneath, the same gesture as the page rules, rather than only changing colour. The
`ActionLink` fills with ink and nudges its arrow 6px. Rows are not interactive, so they
have no hover state at all.

### Safety

The hidden pre-state lives inside `@media (scripting: enabled)` in `globals.css`. If
scripting is off, or the browser does not know that query, none of it applies and the page
renders fully visible. No content on this site can be hidden by a script that failed to
run, and there is no inline script to make it so.

`prefers-reduced-motion: reduce` clears every transform, blur, and transition, and turns
smooth scrolling off. Use `Reveal` and `data-rule` rather than hand-rolling motion and
this keeps holding.

## Accessibility

Measured against paper (`#f5f1e8`), which is the only background on the site:

| Colour | Ratio | Verdict |
|---|---|---|
| `ink` | 16.4:1 | Passes AA and AAA at any size. |
| `ink-soft` | 8.6:1 | Passes AA and AAA at any size. Body copy lives here. |
| `muted` | 4.9:1 | Passes AA at any size. |
| `brass-deep` | 5.0:1 | Passes AA at any size. |
| `brass` | 3.5:1 | Large text only, meaning 24px and up. Fails AA below that. |
| `line` | 1.4:1 | Decorative rules only. Never a border that carries meaning. |

Two of these are deliberate departures from the original designs, in which muted
(`#8a8272`, 3.4:1) and brass (`#9a7b3f`, 3.5:1) were both used for 11px to 13px text,
which needs 4.5:1. Muted was darkened, and brass was split into a display colour and a text
colour rather than darkening the headline accent. If you retune the palette, re-measure:
the ratio is `(L1 + 0.05) / (L2 + 0.05)` on relative luminance, and getting it wrong is
invisible to you and not to the person reading it.

Measured against the plate's own ground (`#16161d`), which is the only place these appear:

| Colour | Ratio | Verdict |
|---|---|---|
| `app-text` | 14.6:1 | Passes AA and AAA at any size. |
| `app-accent` | 5.7:1 | Passes AA at any size. |
| `app-muted` | 5.3:1 | Passes AA at any size. Secondary labels live here. |

The app's palette was measured before it was copied, not after. It passed, so the plate is
faithful with no departure. If a future theme change drops one of these below 4.5:1, the
plate departs from the app on that value and this table records it, the way the brass and
muted departures above are recorded.

Other standing rules:

- Focus is a brass 1px outline with 3px offset, set globally. Do not remove it.
- Nav links stay visible at every width. The original designs hid them below 640px,
  which leaves a phone with no way to move around the site.
- One `h1` per page, `h2` for row titles, in order.
- Decorative arrows and rules get `aria-hidden`.

## Adding a page

1. `src/app/<name>/page.tsx`, exporting `metadata` with a `title` and a `description`.
   The title template in `layout.tsx` appends the product name, so pass "Status" on its
   own rather than repeating the product name in it.
2. Open with `<main className="flex-1 pt-24 pb-28">` and a `Wrap`.
3. Build the page out of the components above. If the page needs a shape that does not
   exist yet, add it to `layout.tsx` and document it here in the same commit, so the next
   page inherits it instead of reinventing it.
4. Content that repeats or grows goes in `src/lib/`, not inline in the page.
5. Read [VOICE.md](./VOICE.md) before writing the words.
