# Value controls in bay: what exists, what editors use, what to build

> Corrected 2026-09-28 per `audit.md` §11.4: react-dial-knob's release date, react-colorful's
> `onChangeEnd` (confirmed), and the sourcing strength of the modifier rows in §2.5. The code
> comment the audit named (`NumberField.tsx:125`) went with the modifier flip.

Research note, 2026-09-28. Read-only survey of `src/renderer/src` at `ab78d03` on
`rnd/entertaining-edits`, plus the web sources cited inline. Anything I could not check against a
primary source is marked **(unverified)**.

## The short version

- **The problem is narrower than "everything is a slider".** bay already has a controls kit in
  `src/renderer/src/components/`: `NumberField` (a scrubbable number), `Slider`/`SliderField`,
  `SegmentedControl`, `Switch`, `Select` (native), `ColorField` (native picker plus hex) and
  `FontFamilyField`. Counted by call site in the renderer, outside `components/`: NumberField 41,
  Select 32, SegmentedControl 10, ColorField 9, SliderField 12, bare Slider 4, Switch 5 (plus 5
  `SwitchRow`), Checkbox 2. Most values are already scrubbable number fields.
- **The sliders sit where pro editors use a different kind of control.** Lift, gamma and gain are
  one averaged slider each, where editors have colour wheels. Volume is a horizontal slider, even on
  the Audio page mixer, where editors have a vertical dB fader. Pan is a slider, where editors have a
  knob. Temperature, tint, saturation, opacity and the eight look filters are sliders. The ease
  control is a preset `Select` that cannot edit a custom curve. Curves exist in the model, but the
  UI says "Curves are set by the agent".
- **Three faults in the kit itself matter more than the widget choices:**
  1. **The modifier keys are backwards compared with Adobe and inconsistent inside bay.**
     `NumberField` drags Shift = fine (÷10) and Alt = coarse (×10) (`NumberField.tsx:126,133`). The
     same field's arrow keys use Shift = ×10, which is coarse (`NumberField.tsx:204`). Premiere and
     After Effects use Shift = coarse and Ctrl/Cmd = fine. Resolve uses Alt = fine (sources below).
  2. **No double-click reset on `NumberField`, `Slider` or `SliderField`.** Only three places add it
     by hand: the Mixer's fader, the Mixer's pan, and the Inspector's pan row
     (`Mixer.tsx:125,140`, `AudioSection.tsx:103`).
  3. **Dragging does not preview live.** `NumberField`'s doc comment says a transient-edit mode
     "does not exist yet" (`NumberField.tsx:51-58`). It does now: `beginGesture`/`endGesture`
     (`store/types.ts:666`) is what `TransformOverlay` uses so a canvas drag lands live and still
     makes one undo step. The kit can take gesture callbacks from its caller. Components must not
     reach the store, so the callbacks come from the caller.
- **Licences:** shadcn/ui is MIT, Radix Primitives MIT, react-colorful MIT, react-knob-headless MIT,
  quickLiquid MIT (already in `NOTICE`), and react-dial-knob MIT but abandoned. **iro.js is MPL-2.0,
  not MIT.** **React Bits is MIT + Commons Clause.** bay can ship it inside a commercial product, but
  must not redistribute the components as components. I recommend reading its patterns and not
  copying them in (§3.2).
- **Recommendation:** fix the three faults in `NumberField`/`Slider` first. Then build five
  controls: `Fader`, `Knob`, `ColorWheel`, `EaseEditor` and `TimecodeField`. Adopt
  `react-colorful` inside `ColorField`'s popover, and treat Radix primitives as an option, not a
  requirement. Everything maps back to the inventory in §4.3.

---

## 1. Inventory of every value control in the renderer

"Keyframeable" means the property is in `KEYFRAME_PROPERTIES` (`src/shared/project.ts:283`):
`opacity, left, top, width, height, rotation, scale, volume`. Limits come from `KEYFRAME_LIMITS`
(`src/shared/keyframes.ts:301`). Every time field below uses `{...tc}`, which parses a timecode,
`4.5s` or `135f`, and stores frames. "Uses" counts rendered instances when the call site is inside
a `.map`.

### 1.1 Inspector › File / Video / Audio tabs (`editor/Inspector.tsx`)

| Where | Sets | Unit, range | Keyed | Control today | Uses |
|---|---|---|---|---|---|
| `Inspector.tsx:404` | Start (`moveItem`) | frames as timecode, ≥0 | no | NumberField row + tc | 1 |
| `:426` | Duration (`trimItem end`) | frames as timecode, ≥1 | no | NumberField row + tc | 1 |
| `:454` | Source in | frames as timecode, 0…source length | no | NumberField row + tc | 1 |
| `:496` | Speed (`setClipSpeed`) | ×, 0.1–8, step 0.05 | no | NumberField, suffix × | 1 |
| `:527`, `:537` | Fade in / Fade out | frames as timecode, ≥0 | no | NumberField row + tc | 2 |
| `:579` | Measure X/Y from (`LAYOUT_ORIGINS`) | enum | no | Select | 1 |
| `:593`, `:597` | X, Y (`layout.left/top`) | canvas px, unbounded | **yes** | NumberField row, px | 2 |
| `:601`, `:605` | Width, Height | px, ≥1 | **yes** | NumberField row, px | 2 |
| `:609` | Rotation | degrees, unbounded, 0.1 precision | **yes** | NumberField row, ° | 1 |
| `:615` | Scale | % (stored 0–100 as a factor) | **yes** | NumberField row, % | 1 |
| `:627` | Opacity | 0–1, shown as % | **yes** | SliderField | 1 |
| `:652` (`CROP_EDGES`) | Crop top/bottom/left/right | %, 0–98 | no | NumberField row, % | 4 |
| `ClipCommands.tsx:227` | Speed (clip menu › Speed…) | ×, 0.1–**16** | no | NumberField in a popover | 1 |

Note that Speed is capped at 8× in the Inspector (`Inspector.tsx:522`) and 16× in the clip menu's
Speed… dialog (`ClipCommands.tsx:232`). The same property has two ceilings, depending on where it
is edited.

**Composite** (`editor/AdjustmentsSection.tsx`, `BlendSection`): blend mode `Select` (`:258`, 16
modes).

**Audio** (`editor/AudioSection.tsx`):

| Where | Sets | Unit, range | Keyed | Control today | Uses |
|---|---|---|---|---|---|
| `:88` | Volume | dB, −60 (−∞) to +6.02 (`MAX_VOLUME_DB`), step 0.5 | **yes** | SliderField, not bipolar | 1 |
| `:107` | Pan | −1…1, origin 0 | no | SliderField, double-click row to centre | 1 |
| `:128`, `:138` | J/L cut: sound early/late | frames as timecode, ≥0 | no | NumberField + tc | 2 |
| `:169` | Duck under another track | bool | no | Switch | 1 |
| `:186` | Duck key track | enum (tracks) | no | Select | 1 |
| `:196` | Duck amount | dB, 0.5–40 | no | NumberField, dB | 1 |
| `:209`, `:219` | Duck attack/release | frames as timecode | no | NumberField + tc | 2 |

**Keyframes** (`editor/KeyframesSection.tsx`): Key at, a time field (`:141`), and Ease, a `Select`
(`:152`) over `linear | hold | in | out | inOut`. A custom `[x1,y1,x2,y2]` bezier
(`KeyframeEase`, `project.ts:264`) shows as a disabled "Custom curve" option: it can be displayed
but not edited.

**Keyframe diamonds** sit to the **right** of the field (`Keyed`, `KeyframeControls.tsx:156`). They
have three states: hollow/dim, hollow/lit, filled. Section headers have prev/next key buttons.
This matches Resolve's placement **(unverified against a Resolve manual page; it matches Resolve
17-19 screenshots I know of)**.

### 1.2 Color page (`editor/color/ColorPanel.tsx` → `editor/GradeSection.tsx`, `AdjustmentsSection.tsx`)

The Color page has no controls of its own. It hosts the Inspector's `GradeSection` under
"Primaries", a LUT list, and `AdjustmentsSection` under "Look filters and blend". None of these
properties are keyframeable.

| Where | Sets | Unit, range (UI track) | Control today | Uses |
|---|---|---|---|---|
| `GradeSection.tsx:175` (`SCALARS`) | Temperature | K offset −3000…3000, step 10, neutral 0 | SliderField, centred | 1 |
| | Tint | −1…1, neutral 0 | SliderField, centred | 1 |
| | Grade saturation | 0–4 (track 0–2), neutral 1 | SliderField, centred | 1 |
| `:196` (`WHEELS`) | Lift / Gamma / Gain, **mean of R,G,B** | lift −1…1, gamma −0.9…4, gain −1…4; step 0.005 | SliderField, centred | 3 |
| `:217` (`WHEELS × CHANNELS`) | Per-channel R/G/B of each wheel | same | NumberField row, 3 decimals, inside a Disclosure | 9 |
| `:241` | LUT | asset id | Select | 1 |
| `:261` | LUT intensity | 0–1 as % | SliderField | 1 |
| `:275` (`AMOUNTS`) | Halation / Vignette / Grain amount | 0–1 as % | SliderField | 3 |
| `:293` | Halation threshold | 0–0.99 | SliderField | 1 |
| `:306` | Halation radius | px 0.5–200 | NumberField | 1 |
| `:322` | Halation glow colour | hex | ColorField | 1 |
| `:333` | Grain size | px 0.5–16 | NumberField | 1 |
| (none) | Curves | model has them | "Curves are set by the agent" (`:234`) | 0 |
| `AdjustmentsSection.tsx:163` (`CONTROLS`) | Brightness, Contrast, Saturate (0–3 at 1), Hue (−180…180°), Blur (0–40 px), Greyscale, Sepia, Invert (0–1) | per row | SliderField, centred on identity | 8 |

`centredRange` (`Slider.tsx:40`) is a good piece of work. It keeps the neutral value at mid-track
and stretches the track when the agent sets a value past it. Any replacement should keep it.

### 1.3 Audio page (`editor/audio/Mixer.tsx`)

| Where | Sets | Unit, range | Control today | Uses |
|---|---|---|---|---|
| `Mixer.tsx:78` | Track level | dBFS meter, vertical, with readout | `AudioMeter` | 1 per track |
| `:130` | Track fader `track.volume` | dB −60…+6.02, origin 0 | **horizontal** Slider; double-click the wrapper resets to 0 dB | 1 per track |
| `:145` | Track pan | −1…1, bipolar | horizontal Slider; double-click centres | 1 per track |
| `~:95-107` | Mute / Solo | bool | hand-rolled toggle buttons | 2 per track |
| `:165` | Master meter | dBFS vertical with scale | `AudioMeter` | 1 |

The meter is vertical and the fader beside it is horizontal, which is the opposite of every
console layout.

### 1.4 Text and titles (`editor/TextStyleSection.tsx`)

| Where | Sets | Control today |
|---|---|---|
| `:165` + `:177` | Font family (list plus "Other…" free text) | Select, then `FontFamilyField` (TextField) |
| `:182` | Weight | Select |
| `:191` | Size, px 1–2000 | NumberField |
| `:201` | Line height, × 0.5–4 | NumberField |
| `:212` | Letter spacing, px | NumberField |
| `:222` | Colour | ColorField |
| `:226`, `:236` | Horizontal / vertical alignment | SegmentedControl (icons) |
| `:287`, `:292` | Outline colour / width 0–64 px | ColorField, NumberField |
| `:324`–`:345` | Shadow colour, blur 0–200, X, Y | ColorField, NumberField ×3 |
| `:375`–`:391` | Plate colour, pad 0–400, round 0–400 | ColorField, NumberField ×2 |

**Subtitles** (`SubtitlesSection.tsx`): clip `Select` (`:239`), language `Select` (`:250`), a design
radiogroup of tiles (`:260`), highlight `ColorField` (`:300`), Size SliderField 0.5–2× (`:302`),
Bottom SliderField 0–90 (`:312`).

**Composition variables** (`CompositionSection.tsx:150-225`) are declared by the composition and
rendered as ColorField, Switch, Select, SliderField (when min and max are given), NumberField, or a
raw text `<input>` (`:222`).

### 1.5 Transitions

- `inspector/TransitionTab.tsx:163` kind `Select`, `:172` direction `Select`, `:181` Duration as a
  NumberField in **frames**, suffix `f`, min 2, step 2.
- `TransitionDialog.tsx:154/165/175` has the same three controls.
- There is no ease control. The duration is typed as frames only, while every other duration in the
  Inspector accepts a timecode.

### 1.6 Export and Deliver (`editor/ExportDialog.tsx`, reused by `deliver/DeliverSettings.tsx`)

Preset `Select` (`:149`), container `Select` (`:187`), quality `Select` (`:191`), size `Select`
(`:203`), loudness mode `Select` (`:283`), target NumberField −40…−5 LUFS (`:305`), peak NumberField
−12…0 dBTP (`:320`), range `Select<RangeKind>` (`:364`: whole, marks, …), file name and folder
TextFields (`:409`, `:418`). There is no in/out range control beyond the marks option.

### 1.7 Preferences and project settings

- `settings/sections.tsx`: Theme SegmentedControl (`:181`), Debug Switch (`:207`), image length
  NumberField in s (`:244`), transition length NumberField in s (`:261`), new-clip framing
  SegmentedControl (`:277`), 4 SwitchRows, guides Switches (`:358`), agent model / effort / Claude
  model SegmentedControls (`:424`, `:439`, `:447`, `:460`).
- `settings/ProvidersSection.tsx:120`, `:134`: **raw `<input type="number">`** for the budget in USD
  and jobs at once. These are the only number inputs outside the kit.
- `settings/ProjectSettingsDialog.tsx`: canvas preset `Select` (`:228`), W/H NumberFields (`:243`),
  frame rate `Select` (`:262`), background ColorField (`:278`), fit SegmentedControl (`:298`).
- `inspector/TimelineTab.tsx`: canvas `Select` (`:33`), frame rate `Select` (`:54`), background
  ColorField (`:77`).

### 1.8 Timeline, viewer and elsewhere

- **Timeline zoom:** `TimelineToolbar.tsx:491`, a Slider over log(pixels per frame) with zoom −/+
  buttons. It is hidden at tight density. This is the right control; Resolve uses the same.
- **Viewer zoom:** `ViewerRegion.tsx:37`, a Select.
- **Playhead timecode:** `viewer/TimecodeField.tsx:55`, a button that becomes a TextField to type a
  time. It cannot be scrubbed.
- **Source viewer position:** `SourceViewer.tsx:303`, a Slider in frames.
- **Layout mode:** `TopBar.tsx:46`, a SegmentedControl.
- **On-canvas transform:** `viewer/TransformOverlay.tsx` handles move, resize, rotate knob and crop,
  and lands live through `beginGesture`. This is bay's XY pad and rotation dial already.
- **Library:** sort and filter Selects in `MediaPool.tsx:389`, `EffectsLibrary.tsx:144` and
  `TranscriptPanel.tsx:252`. AI generation Selects are in `ai/GeneratePanel.tsx:207`, `:344`, `:365`
  and `:370`.
- **Scroll-wheel adjust:** none. No control in the renderer has an `onWheel` value handler.

---

## 2. What professional editors use, by kind of value

These are the sources I could reach. Adobe's help pages and the Blackmagic forum returned 403 to
the fetcher. Where a claim comes from a search-result excerpt of such a page, the note says so.

### 2.1 Scrubbable number fields ("hot text", "virtual sliders")

- **After Effects:** drag the value. Ctrl/Cmd-drag moves in tenths and Shift-drag in tens.
  Source: an Adobe community thread quoted in search results,
  <https://community.adobe.com/t5/after-effects-discussions/can-i-get-the-quot-hot-text-quot-to-work-the-way-it-does-in-premiere/m-p/9616381>
  ("Hold down CTRL and you scrub … single decimal digits. Hold down SHIFT … values of 10s").
- **Premiere Pro:** Shift speeds the scrub up and Ctrl/Cmd slows it down. Source: the Wipster tips
  article, <https://www.wipster.io/blog/how-to-work-faster-in-adobe-premiere-pro-cc-20-master-tips-for-video-editors>,
  and an Adobe community thread on slider drag,
  <https://community.adobe.com/t5/premiere-pro-discussions/the-new-quot-feature-quot-in-premiere-where-the-slider-doesn-t-drag-is-awful/td-p/12031801>.
- **Resolve:** Alt-drag in an Inspector field gives finer adjustment. Source: a Blackmagic forum
  thread, <https://forum.blackmagicdesign.com/viewtopic.php?f=33&t=115458>, seen through a search
  excerpt only **(unverified against the Resolve manual)**. Resolve Inspector parameters pair a
  slider with a scrubbable number, and each parameter has its own reset arrow
  (<https://davinciresolveclub.com/davinci-resolve-inspector/>).
- **Final Cut Pro:** drag over the number, or click, type and press Return. Each effect has a Reset
  button (<https://support.apple.com/guide/final-cut-pro/adjust-effects-ver4e3296f/mac>). I found
  no Apple source for a fine-drag modifier **(unverified)**.
- **CapCut:** slider plus number box pairs, with a diamond per property **(unverified; no primary
  source fetched)**.

The shared convention is: drag horizontally, click to type, Enter commits, Esc cancels, arrow keys
step, and **Shift makes the step bigger** in Adobe's tools. The fine key differs by product: Cmd in
Adobe, Alt in Resolve. bay currently uses Shift for fine, which matches none of them.

### 2.2 Colour wheels, master rings and pickers

- **Resolve:** Lift, Gamma, Gain and Offset each have a balance wheel plus a **master wheel**, a
  horizontal jog strip under each wheel for YRGB. **Double-click the wheel centre to reset**; double-
  click a numeric label to reset that number; each wheel's reset arrow neutralises it. Sources:
  Larry Jordan, <https://larryjordan.com/articles/get-started-with-the-color-page-in-davinci-resolve/>,
  and the Resolve 18 Colorist Guide,
  <https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-18-Colorist-Guide.pdf>
  (search excerpt).
- **Premiere Lumetri:** Shadows, Midtones and Highlights wheels, each with a brightness slider beside
  it. **Double-click resets a wheel.** Source:
  <https://helpx.adobe.com/premiere/desktop/correct-color/add-color-effects/correct-color-using-color-wheel.html>
  (search excerpt; the page 403'd).
- **Colour pickers:** Resolve, Premiere and FCP all open a picker with an eyedropper and a hex field.
  bay's ColorField uses the macOS native picker, which has an eyedropper, plus a hex field
  (`ColorField.tsx:24-33`). That already meets this convention.

### 2.3 dB faders, meters and pan

- **Resolve Fairlight:** a vertical fader beside a vertical meter. "To reset the level to default
  level of 0 dB, double-click a fader's handle." Each channel strip has a panner. Source: the
  Resolve 18 manual, Fader Controls, as mirrored at steakunderwater (excerpt via search; the page
  later 404'd), and <https://motionarray.com/learn/davinci-resolve/fairlight-audio-tutorial/>.
- **Premiere Audio Track Mixer:** vertical faders plus a **pan knob** per track.
  <https://helpx.adobe.com/premiere/desktop/add-audio-effects/advanced-audio-techniques/about-audio-track-mixer.html>.
  A modifier-click reset is **(unverified)**.
- **Fader law:** consoles space dB non-linearly (more travel near 0 dB). Bay's slider is linear in
  dB, which already puts more travel near 0 than a linear-gain slider would. A proper taper is a
  refinement, not a fix.

### 2.4 The other value kinds on the owner's list

| Kind | Where pros use it | bay today |
|---|---|---|
| Rotation dial | AE rotation: revolutions × degrees hot text plus a dial in the Effect Controls for angle effects; Resolve uses a number with a canvas rotate handle | NumberField plus canvas knob, which is fine |
| XY pad for position/anchor | AE/Premiere use on-canvas handles; Resolve's Inspector shows X/Y numbers with an on-viewer transform. An XY *pad* in a panel is rare in NLEs **(unverified as a norm)** | NumberFields plus TransformOverlay, which is fine |
| Curves | Resolve Custom Curves, Lumetri RGB Curves, FCP Color Curves | none |
| Segmented controls | Alignment and similar enums | SegmentedControl, which is good |
| Steppers | Rare in NLE inspectors; a scrub field serves as the stepper | none needed |
| Timecode field | Every NLE: type `+15` for a relative move, `.` for a separator, scrub to change **(the relative-entry claim is unverified for Resolve)** | parse tc/s/f, but no relative entry and no scrub on the playhead |
| Duration field | Premiere and Resolve durations are timecode | tc everywhere except transition duration (frames) |
| Easing editor | AE Graph Editor / Keyframe Velocity; Premiere's Bezier keyframe handles | preset Select only |
| Font picker with previews | Resolve Text+ and Premiere Essential Graphics list families rendered in their own face **(unverified for current versions)** | Select plus free text, no previews |
| In/out range slider | Export range in Premiere and Resolve is In/Out marks on the timeline | marks option in a Select, which is enough |

### 2.5 Conventions users expect (the spec §4 implements)

| Gesture | Convention | Evidence |
|---|---|---|
| Double-click control | reset to default | Resolve wheels, faders, labels; Lumetri wheels (above) |
| Shift + drag / arrow | coarse, ×10 | AE, Premiere (Adobe community threads and search excerpts; helpx 403s) |
| Cmd + drag (Adobe) or Alt + drag (Resolve) | fine, ÷10 | AE, Premiere (community/search excerpts) / Resolve (Blackmagic forum only; not found in the manual) |
| Click value | type | FCP, all |
| Enter / Esc | commit / cancel | all |
| Arrow up/down | step | all |
| Scroll wheel over a focused field | step **(unverified as a Resolve/Premiere default; Figma and Blender do it)** | not a safe default in a scrolling inspector |

---

## 3. Libraries: licence and fit

Only `react-resizable-panels` (MIT, through a copied-in shadcn `resizable.tsx`), `lucide-react`,
`clsx`, `tailwind-merge` and `zustand` are in `package.json`. None of Radix, shadcn, react-colorful,
knob libraries or Motion is present.

### 3.1 shadcn/ui: MIT, copy-in

- Licence: "MIT License … Copyright (c) 2023 shadcn",
  <https://github.com/shadcn-ui/ui/blob/main/LICENSE.md>.
- It is built on Radix Primitives: "MIT License … Copyright (c) 2022 WorkOS",
  <https://github.com/radix-ui/primitives/blob/main/LICENSE>. `@radix-ui/react-slider` is 1.4.7
  and MIT (npm registry).
- **Fit.** bay already copied one shadcn component the right way. `components/ui/resizable.tsx`
  re-points colours at bay tokens and avoids `shadcn init`, which would rewrite the stylesheet.
  Keep that rule for anything else. What shadcn would add over bay's own kit:
  - **Slider** (Radix): two-thumb ranges and a vertical orientation for free. Worth it only for
    the vertical fader and a future range control. bay's `Slider` already has whole-track drag,
    origin fill and centred ranges, which Radix does not.
  - **Popover, Tooltip, Command**: bay has its own `Popover`, `Tooltip` and `Menu` with a stack
    manager (`floatingStack.ts`, `modalStack.ts`). Swapping them is churn without a user-visible
    gain. **Command** (cmdk, MIT) is the one I would take, for the font picker's type-to-search list
    with previews.
  - **Toggle Group**: bay's `SegmentedControl` is already a `radiogroup` with arrow keys.
  - **Select**: bay deliberately keeps the native menu (`Select.tsx:20-23`). Keep it, except the
    font picker needs previews, which a native `<select>` cannot draw.

### 3.2 React Bits: MIT + Commons Clause. Allowed in a product; do not copy in

- Licence: "MIT + Commons Clause License Condition v1.0". It says "You may use this Software,
  including for any commercial purpose, so long as you do not sell, sublicense, or redistribute the
  components themselves" (alone, in a bundle, or as a port).
  <https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md>.
- **Verdict.** Shipping a React Bits component compiled inside bay's app is permitted commercial
  use. bay's source repository is what makes me stop. If that repository is ever public, or shared
  as source with anyone, the copied component file is being redistributed as a component, which is
  exactly what the clause forbids. It would also be the only non-OSI licence in the tree, next to
  the MIT/LGPL notices in `NOTICE`. **Recommendation: use React Bits as a reference for interaction
  details and write bay's own code.** Do not paste its files. *Not legal advice; if the owner wants a
  specific component, ask the author for an MIT grant.*
- **Which pieces are relevant.** Listed from the repo tree `src/ts-tailwind/`:
  - `Micro/ScrubField` is a scrub field with `role="spinbutton"`, `aria-valuetext` and a floating
    value chip while dragging. It uses Shift = coarse and Alt = fine (`multiplierOf`, line 141),
    which is the Adobe/Resolve-compatible mapping and **the opposite of bay's**. It depends on
    `motion`.
  - `Components/ElasticSlider`, `Micro/WakeSlider`, `Micro/CometDial`, `Micro/RubberSegment` and
    `Micro/SquishSwitch` are springy, decorative motion. Rubber-banding a grade slider makes the
    value harder to read, which is a poor fit for a pro tool. They also need `motion/react`, a new
    dependency.
  - `Components/GlassSurface` and `Components/FluidGlass` do the same thing as quickLiquid
    (`backdrop-filter: url(#svg-filter)` with a CSS fallback). There is no reason to take a second
    glass engine.
  - `Components/Stepper` is a wizard step indicator, not a numeric stepper. `Components/Counter` is
    animated digits.

### 3.3 quickLiquid: MIT, already carried as data

- Licence: MIT ("Copyright (c) 2026 Amarnath"), already reproduced in `NOTICE:29-37`. Repository:
  <https://github.com/amarnath3003/quickLiquid>.
- How it renders: SVG displacement maps through `backdrop-filter: url(...)`. Full refraction works
  in Chromium only (Electron is Chromium, so it works here); other browsers get a CSS fallback.
  Displacement maps are cached and refcounted, with `'high' | 'medium' | 'low'` quality settings. It
  exports `LiquidGlass` (React), `LiquidGlassEngine` (DOM), and `LiquidButton`, `LiquidTabBar` and
  similar.
- bay copies only `MATERIAL_PRESETS` into `src/shared/glass.ts`, for `.brf <glass>`. The package is
  not a dependency (`glass.ts:5-11` explains why).
- **Where glass would help in the chrome:**
  - **Yes:** the AI layout's drawers (`workspace/AiLayout.tsx`: the side drawer and timeline drawer
    open over the viewer and agent). Glass keeps the underlying context visible, which is the point
    of a drawer that does not leave the mode. The same goes for the viewer HUD over the picture
    (`viewer/ViewerControls.tsx`, `DebugHud.tsx`, which already uses `backdrop-blur-sm`), transient
    popovers such as the colour, ease and font pickers, and toasts.
  - **No:** inspector rows, the timeline, number fields and meters. Low-contrast text over a moving
    picture is the legibility failure, and these are read continuously.
  - **Performance caveat (unmeasured):** a `backdrop-filter` over the playing viewer canvas has to
    re-filter every composited frame. SVG displacement costs more than a plain blur. Use the `thin`
    or `regular` preset with plain `blur() saturate()` and no displacement over the viewer while it
    plays, and measure with `test/app` frame probes before shipping. The rule in CLAUDE.md applies:
    count pictures, not ticks.
  - **Legibility guard:** keep tint opacity high enough that body text over the drawer passes 4.5:1
    against the *worst* backdrop (a white frame). Check it on a white clip and on a black one.
  - `glass-engineer` is active on this team; coordinate before building a chrome glass surface
    twice.

### 3.4 Knobs and faders

| Library | Licence | Status | Fit |
|---|---|---|---|
| **react-knob-headless** (<https://github.com/satelllte/react-knob-headless>) | MIT (npm) | 0.4.0; npm modified 2025-06-25. Deps: `@use-gesture/react`, `@dsp-ts/math`. **peerDependencies stop at React 18**, and bay is on React 19 | Headless and follows the ARIA slider pattern, built for audio. Usable with a pnpm peer override, **untested on React 19**. Small enough to write instead |
| **react-dial-knob** (<https://github.com/pavelkukov/react-dial-knob>) | MIT (npm) | last release 1.3.0 on 2021-01-31 (npm's `modified` 2022-05-14 is metadata; last repo push 2022-09-16); peer `react ^17.0.1` | **Reject.** Abandoned, and its skins are not bay's look |
| **@radix-ui/react-slider** | MIT | 1.4.7 | Vertical orientation for the fader, and multi-thumb |

Recommendation: **build `Knob` and `Fader` on bay's own `useDrag`** (`lib/useDrag.ts`), which
already reports shift/alt/meta. Each is about 150 lines. A dependency whose peer range excludes bay's
React is not worth the saving.

### 3.5 Colour

| Library | Licence | Notes |
|---|---|---|
| **react-colorful** (<https://github.com/omgovich/react-colorful>) | **MIT** | 3.1 KB gzipped, zero deps, WAI-ARIA with keyboard support, `HexColorPicker`/`HexColorInput`/alpha variants. npm latest 5.8.1 (registry, modified 2026-09-01). `onChangeEnd` is confirmed in the README ("Called when the user finishes changing a color (mouseup, touchend, or keyup)"), so commit-on-release comes for free |
| **iro.js** (<https://github.com/jaames/iro.js>) | **MPL-2.0, not MIT** | Wheel, box, sliders and kelvin; about 9 KB. The maintainer marks it "on hiatus". MPL is file-level copyleft: fine to use unmodified, but modified files must stay MPL. It is also not a lift/gamma/gain wheel |

Neither library is a grading wheel. A grading wheel is a chroma offset (a puck on a disc, spring to
centre) plus a master jog, not a hue/saturation picker. **Build `ColorWheel`.** Use react-colorful
only if the native picker in `ColorField` becomes a problem. It is not one today: macOS supplies the
eyedropper and palettes.

### 3.6 Electron-specific

- **Native menus:** `Menu.buildFromTemplate().popup()` for context menus. bay already keeps
  `<select>` native for the same reason.
- **Window materials:** `BrowserWindow` `vibrancy` (macOS) / `backgroundMaterial` (Windows 11) give
  OS-drawn translucency for sidebars at no renderer cost. bay does not use them (grep finds nothing).
  They are an alternative to CSS glass for the *window-level* chrome only. They do not apply inside
  a panel.
- **Eyedropper:** Chromium's `EyeDropper` API could sample the viewer from inside the page. That
  matters for a grade wheel's "pick neutral" **(unverified in Electron 44; test before relying on
  it)**. The native `<input type="color">` already gives the macOS eyedropper.
- **Accent colour:** `systemPreferences.getAccentColor()` if bay's accent should follow macOS. That
  is a product choice.

---

## 4. Recommendation: the bay controls kit

### 4.1 Fix the existing controls first (highest value, smallest change)

1. **Modifiers, one table for the whole kit, drag and keys alike:**
   - Shift = coarse ×10. This matches AE and Premiere and fixes the inverted drag.
   - Alt/Option = fine ÷10. This matches Resolve and React Bits' ScrubField.
   - Cmd = fine ÷10 as an alias, for Adobe muscle memory. `useDrag` already reports `meta`.
   - Apply the same table to `NumberField` drag (`:126`, `:133`), `NumberField` arrows (`:204`,
     which gains the fine step) and `Slider` keys (`:132`).
   - bay has so far told nobody that Shift means fine; the Inspector hint texts do not mention it.
     The flip therefore breaks no documented promise, but say so in the release note.
2. **Double-click resets to default** on every `NumberField` label, `Slider`/`SliderField` track and
   readout. It is one undo step. Add a `defaultValue` prop. When it is absent, double-click does
   nothing. Remove the three hand-rolled wrappers once the kit does it.
3. **Live preview while dragging.** Add `onGestureStart`, `onInput` and `onGestureEnd` callbacks.
   The caller (Inspector, Mixer) maps them to `beginGesture`, the live store action and
   `endGesture`. The result is one undo step, as `TransformOverlay` already does. Update the stale
   comment at `NumberField.tsx:51-58`.
4. **Bring the stragglers into the kit:** ProvidersSection's two raw number inputs become
   `NumberField`; transition Duration accepts a timecode like every other duration (keep an `f`
   readout if frames matter at a cut); make Speed one ceiling in both places.

### 4.2 New controls: build or adopt

| Control | Build or adopt | Interaction spec | ARIA |
|---|---|---|---|
| **ScrubNumber** (today's `NumberField`, fixed as in §4.1) | exists | Drag the label or the value horizontally; `ew-resize` cursor; Shift ×10, Alt/Cmd ÷10; click to type (select all); Enter commits; Esc restores; ↑/↓ step with the same modifiers; double-click the label resets. `format`/`parse` for units. `mixed` shows "Mixed", and typing a value applies it to all. Disabled at 40% opacity with no drag | `role="spinbutton"` on the input, with `aria-valuenow/min/max` and `aria-valuetext` including the unit ("45 degrees"). Today it is a plain textbox with an `aria-label` |
| **Slider** (exists) | exists; add vertical plus `defaultValue` | Whole track is the target; origin fill; `centredRange`; double-click resets; modifiers as above; PageUp/PageDown ×10 | `role="slider"` (present) plus `aria-valuetext` from `format` |
| **Fader** | **build** (a vertical `Slider` plus meter plus dB scale) | Vertical, dB taper (unity about ¾ up), unity tick; grab anywhere; Shift coarse, Alt fine; double-click 0 dB; the readout doubles as a ScrubNumber for typing `-6`; "−∞" at the floor. The meter sits beside it and shares the same scale | `role="slider"`, `aria-orientation="vertical"`, `aria-valuetext="−6.0 dB"` |
| **Knob** | **build** on `useDrag` | Vertical drag (up = right), not circular, which is the audio-plugin convention and what react-knob-headless does; 270° arc; bipolar fill from centre; double-click centres; value chip on hover and drag; Shift/Alt as above | `role="slider"`, `aria-valuetext="L 30"` / `"Centre"` |
| **ColorWheel** (lift/gamma/gain/offset) | **build** | A disc with a puck for the R/G/B offset as chroma (keeping the mean); a **master jog strip** under it for the YRGB level (drag horizontally, as in Resolve), replacing today's mean slider; double-click the puck resets the balance; double-click the strip resets the master; the reset arrow resets both; Alt fine. Numbers under the wheel are ScrubNumbers (R, G, B, Y), replacing the Disclosure. Mixed shows a hollow puck | Two sliders: puck arrows move the puck, jog arrows move the master. `aria-valuetext` e.g. "Lift: red +0.02, blue −0.01, master −0.05" |
| **ColorField** (exists) | keep native; optionally adopt **react-colorful** in a popover | Swatch opens the picker; hex field; alpha where the model has it. Commit on close or pointerup, never per change (existing rule) | react-colorful's own ARIA |
| **EaseEditor** | **build** | Popover from the Ease row: presets as a SegmentedControl of mini curves (Linear, In, Out, In-out, Hold); a 2-handle cubic-bezier box writes `[x1,y1,x2,y2]` (`KeyframeEase` already stores it); x clamped 0–1, y free for overshoot; Shift snaps handles to 0.05 steps; double-click resets to linear. "Custom curve" stops being a disabled option | Each handle is a pair of sliders (x, y); presets are a `radiogroup` |
| **CurvesEditor** | **build later** | Points on a per-channel curve; the model has curves and the UI has none. Out of scope for the first pass | n/a |
| **TimecodeField** | **build** on ScrubNumber with the `tc` parse | Displays `HH:MM:SS:FF`; drag to scrub frames; type absolute, `+15`/`-1s` relative, or `4.5s`/`135f` (parse exists); the playhead readout (`viewer/TimecodeField.tsx`) uses it too | spinbutton with `aria-valuetext` spoken as "1 minute 4 seconds 15 frames" |
| **SegmentedControl / Switch / Select** | exist | Unchanged | Already correct |
| **FontPicker** | **build** with shadcn **Command** (cmdk, MIT) or a hand-rolled listbox | Type to search; each family drawn in its own face (bay registers imported fonts as FontFace, `engine/importedFonts.ts`); imported fonts first; free text stays as the escape hatch | combobox + listbox |

### 4.3 Every inventory row mapped to a kit control

| Inventory row | Today | Kit control |
|---|---|---|
| Start, Duration, Source in, Fades, J/L, Duck attack/release, Key at | NumberField + tc | **TimecodeField** |
| Transition duration | NumberField (frames) | **TimecodeField** (frames readout) |
| Speed (both places) | NumberField | ScrubNumber, one ceiling |
| X, Y, Width, Height, Scale, Crop ×4 | NumberField | ScrubNumber (fixed modifiers, reset: X/Y to centre, Scale 100%, Crop 0) + TransformOverlay |
| Rotation | NumberField | ScrubNumber; add a small **Knob** beside it only if users ask. Resolve and Premiere show a number |
| Opacity | SliderField | Slider + ScrubNumber readout (Resolve pairs them), reset 100% |
| Clip volume (Inspector) | SliderField | Slider in dB + ScrubNumber readout, reset 0 dB |
| Clip pan (Inspector) | SliderField | **Knob**, reset centre |
| Track fader (Mixer) | horizontal Slider | **Fader**, vertical, beside the existing meter |
| Track pan (Mixer) | horizontal Slider | **Knob** |
| Mute/Solo | hand-rolled buttons | keep (toggle buttons with `aria-pressed`) |
| Duck amount | NumberField dB | ScrubNumber |
| Duck on/key track | Switch / Select | keep |
| Temperature, Tint | SliderField centred | keep Slider, add double-click reset; optionally a gradient track (blue→amber, green→magenta) as Resolve and Lumetri draw them |
| Grade saturation, LUT intensity, Halation/Vignette/Grain amount, threshold | SliderField | keep Slider + reset |
| Lift/Gamma/Gain mean + 9 channel fields | SliderField ×3 + NumberField ×9 in a Disclosure | **ColorWheel ×3** (+ Offset if the model gains one) |
| Curves | none | **CurvesEditor** (later) |
| LUT | Select | keep |
| Halation radius, grain size | NumberField | ScrubNumber |
| Halation colour, all text/outline/shadow/plate/subtitle/background colours | ColorField | keep ColorField |
| Look filters ×8 (Adjustments) | SliderField centred | keep Slider + reset; Hue could become a Knob (it wraps), which is optional |
| Blend mode | Select | keep |
| Font family | Select + TextField | **FontPicker** |
| Weight | Select | keep |
| Size, line height, tracking, outline width, shadow blur/X/Y, pad, round | NumberField | ScrubNumber |
| Alignment | SegmentedControl | keep |
| Subtitle size / bottom | SliderField | keep Slider + reset |
| Subtitle design | tile radiogroup | keep |
| Ease | Select of presets | **EaseEditor** |
| Transition kind / direction | Select | direction could be a 4-arrow SegmentedControl, since it has four icon choices |
| Export selects, loudness target/peak | Select / NumberField | keep; ScrubNumber |
| Export range | Select | keep (marks are the in/out control) |
| Preferences segmented/switch rows | SegmentedControl / Switch | keep |
| Preferences lengths (s) | NumberField | ScrubNumber |
| Provider budget / jobs | raw `<input type=number>` | ScrubNumber |
| Canvas W/H, frame rate, canvas preset | NumberField / Select | keep |
| Timeline zoom | log Slider | keep (Resolve uses the same) |
| Viewer zoom | Select | keep |
| Playhead timecode | button → TextField | **TimecodeField** |
| Source viewer position | Slider | keep |
| Composition variables | per declared type | follow the same mapping by type |

### 4.4 Rules that apply to every control

- **Keyframe diamond:** stays at the right of the row (`Keyed`), outside the control's hit area. A
  drag on an animated property keys the playhead (existing Inspector rule). A double-click reset on
  an animated property writes a key at the default, not the static value. The diamond appears for
  single selection only (existing rule).
- **Mixed (multi-select):** the value shows "Mixed" and the slider thumb or wheel puck goes hollow. A
  drag starts from the first item's value; a typed value applies to all. Reset applies to all.
- **Disabled:** 40% opacity, no drag, `aria-disabled`, and a `title` saying why when the reason is
  not obvious. LUT with no LUTs already does this with a hint line.
- **Commit:** one undo step per gesture (drag, typed commit, or reset), with live preview through
  the gesture callbacks in §4.1.
- **Units:** the stored unit stays in the model (fraction, gain, frames); the control formats and
  parses the unit a person means (%, dB, timecode). This is existing practice, so keep it in
  `format`/`parse`.
- **Scroll wheel:** off by default. An inspector scrolls, and a wheel that changes whatever value
  passes under the pointer is how values get changed by accident. If added, adjust only while the
  field is focused.
- **Focus:** each control is one tab stop with a visible 2px ring (`NumberField.tsx:167` already has
  it). A wheel is two stops (puck, jog). Arrow keys never leave the control.
- **Reduced motion:** no spring or rubber-band on value controls at all. That is the reason for not
  taking React Bits' elastic sliders, and it also avoids the reduced-motion question entirely.

### 4.5 Build order

1. The §4.1 fixes (modifiers, double-click reset, live preview, stragglers). They touch
   `NumberField.tsx`, `Slider.tsx`, the two ProvidersSection inputs and TransitionTab. Existing
   probes that drag with Shift will need their modifier updated.
2. `Fader` + `Knob`, then the Mixer and the Inspector pan.
3. `ColorWheel`, then the Grade section.
4. `TimecodeField`, then the timing rows and the playhead.
5. `EaseEditor`.
6. `FontPicker`.
7. `CurvesEditor`.

Dependencies to add: none are required. Optional: `react-colorful` (MIT) and `cmdk` (MIT,
through shadcn Command). Record every addition in `NOTICE`.
