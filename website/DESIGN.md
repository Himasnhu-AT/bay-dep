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
the app's own token name. Do not tune them to taste, and do not use them outside the plate.

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

**Type.** The plate's chrome is Inter, which the app draws its interface in and the site
already loads. The app's monospace is JetBrains Mono, which the site does not load; the
plate uses the app's own fallback, the system monospace, rather than fetch a font for a
dozen tool names.

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
  pointer events and draws a brass focus rule inside the frame.
- **The two videos keep one clock.** The after video leads; on each frame it presents
  (`requestVideoFrameCallback`), the before video is re-seeked only if it has drifted more
  than two frames.
- **Labels are not laid over the picture.** Which side is which is said in the caption
  under it. "Hear the edit" unmutes the after video; nothing plays sound unasked.

The plate is ruled along its top edge in brass and casts no shadow. It is a leaf bound
into a printed page, not a window floating over one, and a drop shadow is the one gesture
that would make the page read as a dashboard.

## Components

All of them are in `src/components/layout.tsx`, and they are server components. The
marketing pages have five client components and no more: `Reveal`, which needs an
observer, the nav, which needs the current path, `ScrollSequence`, which needs scroll
position, `BeforeAfter`, which needs a pointer and two videos, and `DepthFallback`, which
does nothing where CSS scroll timelines work. The
access pages (`/waitlist`, `/waitlist/finish`, `/desktop/sign-in`, `/admin`) are server
pages around one client component each, in `src/components/access/`, because signing in
is interactive by nature.

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
- **`ActionButton`** is `ActionLink` for an action that is not a navigation: send a link,
  request access, approve. Same box and fill. `quiet` drops the box to an underlined
  word, for the secondary action beside a primary one (Continue with Google, Sign out,
  Revoke), so a screen still asks for one thing. Disabled is `line` border and `muted`
  text, with no hover.
- **`Field`** is a line to write on: an eyebrow label and an input ruled underneath in
  `ink-soft`, turning `brass-deep` on focus, never a box. The rule carries meaning here,
  so it may not be `line` (1.4:1). `multiline` makes it a textarea; `hint` is a `text-xs`
  muted line below. Errors are not red: they are a sentence in `ink` ruled down its left
  edge in `brass-deep`, with `role="alert"`, and every one of them says what to do next.
- **`Command`** is a line you would actually type. The only monospace on the site, ruled
  down its left edge in brass on a slightly deeper paper rather than boxed in a shadow,
  so it reads as a line from a terminal and not as a widget. One line each; if you want
  a block of them, stack `Command`s with `space-y-2.5` so each stays a discrete
  instruction.
- **`PullQuote`** closes a page. At most one, and only when the line earns it.
- **`AppPlate` / `AgentPanel` / `ScrollSequence`** are the figure, its agent panel and the
  scroll driver; **`BeforeAfter`** is the comparison under it. Home page only.
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

Four behaviours, and no fifth without amending this section:

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

**Depth** (`data-depth`). The one scroll-linked motion besides the sequence, added at the
owner's request: leaves of one page lifting at different rates as you turn past them.
Three kinds, all in `globals.css`:

- `peel`, the home hero. Each line rises faster than the page by `--depth` of the scroll
  over the first screen (eyebrow 0.16, headline 0.10, lead and rule 0.05, the cue 0) and
  fades toward `--fade`. Upper lines move faster than lower ones, so they separate as they
  leave rather than colliding, and the bottom of the hero moves with the page so it never
  runs into the section under it.
- `enter`, a plate arriving. It starts `--enter` (6vh) below its place and settles as its
  `[data-depth-root]` finishes entering, so the plate reads as set beneath the paper. The
  note above it moves with the page. In the pinned sequence it settles exactly as the
  plate pins; in the stacked fallback each plate does it once.
- `drift`, the numerals beside the home page's rows, `--drift` (18px) either side of their
  place while the row crosses the screen. Marginalia sit at a different depth from text.

How it is built, which is the part to keep: CSS scroll-driven animations
(`animation-timeline: scroll()` / `view()`) of `translate` and `opacity` only, which the
browser runs on the compositor with no script and no layout. Where they are unsupported,
`DepthFallback` reproduces the same curves from one passive, rAF-throttled listener that
reads every rectangle before writing any `translate`. Nothing starts hidden; every
from-state is visible and a few pixels off its place. `prefers-reduced-motion: reduce`
switches all of it off in both paths. Measured with a scrolling frame probe at 1440×900,
before and after, at 1× and 4× CPU throttle: 60fps held in both, with no added layouts
per frame. Keep that true: never animate `top`, `margin`, `height` or `width` from scroll,
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
