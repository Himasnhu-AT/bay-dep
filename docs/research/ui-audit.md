# UI audit: bay editor (2026-09-23)

This audit covers every surface of bay's renderer. Each surface was screenshotted in an isolated
instance, with its own profile and CDP port, holding a realistic project:

- 3 urban-shinobi takes (768×1344)
- 2 generated 1080p clips with tone, one with a 60-character file name
- a 20 s music bed, a still, 2 captions, 2 markers and a dissolve
- one deliberately corrupt file, for the error state

Findings are ordered by severity. For each one the table records what was changed or, if nothing was, what is
proposed. The before/after images in [`ui-audit/`](ui-audit/) were taken at the same window size, from the same
seeded project, with the same selection. The "before" set comes from a baseline build of the untouched renderer,
made for that purpose.

## What the audit was measured against

| Source | What it contributes here |
|---|---|
| WCAG 2.2 **1.4.3 Contrast (Minimum)**, AA [W-CM] | Text under 18.66px bold or 24px needs **4.5:1**. Nearly all of bay's text is 10–12px. |
| WCAG 2.2 **2.4.7 Focus Visible** (AA) and **2.4.13 Focus Appearance** (AAA) [W-FA] | The indicator should be at least the area of a **2 CSS px** perimeter, with ≥3:1 change between focused and unfocused. |
| WCAG 2.2 **3.3.2 Labels or Instructions** / **2.5.3 Label in Name** [W-LB] | A control needs a visible label, and its accessible name should contain that label. |
| NN/g, *10 Usability Heuristics* [NNG-10] | #1 visibility of system status, #4 consistency and standards ("users should not have to wonder whether different words, situations, or actions mean the same thing"), #6 recognition rather than recall ("making elements, actions, and options visible"), #9 help users recognise errors. |
| NN/g, Gestalt proximity [NNG-P] | Items that belong together sit closer than items that don't. |
| Fluent 2 layout [FL-L] | "The base unit is four pixels." Vertical and horizontal alignment of edges; align objects centrally and text left. |
| Material 3 sliders [M3-S] | Show the value (a readout or a paired text field). Use a **centered** slider when the default is in the middle of the range. |
| Apple HIG, layout and sliders [HIG-L][HIG-S] | Consistent control sizes; related items grouped; a slider shows what it controls. |
| bay's own conventions (`styles.css`, `CLAUDE.md`) | 4px grid, one accent kept for primary action and state, hairlines rather than elevation, "a control that does nothing is the fault this codebase keeps finding". |

bay's density suits a pro tool: 11–12px text, 28px controls, hairline section breaks. The audit does not try to
loosen that. It looks for places where the density hides meaning.

## Findings

Severity:
- **Critical**: the control cannot be used as intended.
- **High**: wrong or unreadable information.
- **Medium**: organisation, alignment or legibility costs time.
- **Low**: polish.

### Fixed in this change

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| 1 | **Critical** | **All 8 Adjustments sliders and all 10 Grade sliders had no visible label and no value.** A stack of identical orange lines; the only way to tell Brightness from Contrast was to drag one and watch the picture. The name existed only in `aria-label`, which fails WCAG 3.3.2 and NN/g #6. `Control.unit` ("Shown after the number") was declared and never rendered. The existing probe passed because it looked for `aria-label`, not for visible text. | `inspector-video-top-before.png`, `inspector-video-bottom-before.png` | New `SliderField` (`components/Slider.tsx`): a `Field` caption, the slider, and a fixed-width live readout that updates while dragging and shows "Mixed" for a disagreeing selection. Used for Adjustments (the value plus its unit), Grade (signed values for tint and wheels, `K` for temperature, `%` for amounts) and the inspector's Opacity/Volume. Grade is split into proximity groups: balance · tone · LUT · texture. The LUT select gets a visible "LUT" caption. Accessible names are unchanged (`Temperature (K)`, `LUT intensity`), so probes and screen readers see the same names. See the `-after` images. |
| 2 | **High** | **The Effects panel said colour wheels were "Not yet in the engine … the project format has no field for it"**, while `Item.grade` (lift/gamma/gain, LUTs, grain, halation, vignette) had shipped. This is the third time this list has outlived its field (blur, crop, now grade), and it steers users away from a feature that works. | `panel-effects-before.png` | The row is gone. A "Grade" section points to the inspector the same way the Crop section does. The component's doc comment records the recurrence. |
| 3 | **High** | **Secondary text failed AA contrast everywhere.** `ink-2` (#6e6e6e) carries every field label, hint and readout (102 uses): **3.48:1** on panels and **3.16:1** inside controls. Light theme #7d7d7d: **3.3–4.0:1**. The agent panel drew *readable* text (thoughts, "Thought for …", proposal details, "Show all") in `ink-3`, the disabled token, at **2.0:1**. | all `-before` images | `--color-ink-2`: dark **#8a8a8a** (5.4 / 5.1 / 4.7:1 on surface-0/1/2), light **#666666** (4.6 / 5.2 / 5.6:1). `ink-1` stays #a1a1a1 (6.9:1), so the hierarchy between the two is kept. The six readable `ink-3` uses in `AgentPanel.tsx` move to `ink-2`, and `ink-3` is documented as disabled-only. |
| 4 | Medium | **An audio clip's inspector offered Transform** (Origin, X/Y/W/H, Rotate, Opacity) **and a "Size —" row**: six controls that move nothing visible. Crop and Adjustments were already hidden for audio, so the inspector contradicted itself (NN/g #4). | `editor-audio-selected-before.png` | Transform and the Size readout render only when the selection has a picture, the same `hasVideo !== false` rule Crop uses. |
| 5 | Medium | **A broken asset read as a caption, not an error.** "Could not be read" was grey 10px under a card at 50% opacity, about 2:1 (NN/g #9). Text cards spent their second line on "—". | `media-panel-before.png` | The thumbnail dims; the name stays readable; the error line is `danger` with a warning icon; the card border is tinted. Cards without dimensions name their kind ("Text clip", "HTML composition", "Motion graphic", "Colour LUT"). |
| 6 | Medium | **Clip names were unreadable over bright filmstrips.** The text-shadow alone lost to colour bars and daylight frames ("Colour bars B-roll…" over yellow/white). | `timeline-before.png` | Over video/image filmstrips the name sits on the same `bg-black/55` backing the speed badge already uses. Text, composition and audio clips have solid bodies and are unchanged. |
| 7 | Medium | **Track-header buttons did not line up.** Audio tracks have no eye, so their mute and delete buttons sat one slot left of every video track's (Fluent: align edges; HIG: consistent placement). | `timeline-before.png` | The eye's slot is kept as an empty `size-5` spacer on audio tracks, so lock, eye, mute and delete form columns. |
| 8 | Medium | **At 1024px the timeline zoom slider collapsed to a bare thumb with no track**, a control that looked broken. The transport row runs out of room and flex squeezed that group first. | `narrow-1024-before.png` | The transport is a container-query context. Below 28rem the slider hides and the zoom −/+ buttons (and the −/+ keys) remain; above it the group keeps its 168px. |
| 9 | Low–Med | **Focus on composite fields was a 1px border at 70% accent**, the weakest indicator in the app, below the 2px perimeter of 2.4.13 and below bay's own "one focus treatment, 2px accent" rule. The home search box focused to a grey border. | `focus-select-before.png` | `NumberField`, `Select` and `ColorField` show a full accent border plus a 1px accent ring (2px total) on `focus-within`. The home search focuses to accent. |
| 10 | Low | **The three panel-visibility toggles were permanently lit in the accent.** In the default layout, three orange buttons sat beside the orange Export and diluted the one primary action (hierarchy; bay's own "the accent is for primary action and state"). | `editor-audio-selected-before.png` (top bar) | The "on" state for region toggles is a neutral fill (`aria-pressed:bg-surface-3`). The accent `active` stays for track lock/mute/hide, where it flags an exceptional state. |
| 11 | Low | **In Settings, "Use" was a ghost button among bordered "Download" buttons** and read as a label. **The modal title (13px medium) was weaker than the section headings inside it (13px semibold).** | `settings-before.png` | "Use" and "Chosen" are bordered like Download; "Chosen" keeps its check and turns accent. `Modal` titles are 14px semibold. |

Verification (all runs against the isolated instance, after `pnpm build`):

- `test/app/adjustments-ui.mjs`: **20/20**. It gained 4 checks: every slider shows its name as visible text in its
  own row; the Blur row reads out the stored value with its unit; Transform shows for a video clip (the positive
  control); Transform is absent for an audio clip. **Each new check was run against a baseline build of the
  unchanged renderer and failed there.** The probe stops at its first failure, so the checks were isolated one per
  run: the caption check failed with all 8 labels uncaptioned; with it removed, the readout check failed (`got:
  null`); with both removed, the audio Transform check failed (`got: true`). Before each run, an assertion checked
  that the check-removal edit had actually been made.
- `grade-ui.mjs` 2/2, `settings.mjs` 28 ok, `transitions-ui.mjs` 29/29, `composer-menus.mjs` 25 ok,
  `projects-home.mjs` 25 ok, `text-style.mjs` 13 ok, `transport.mjs` PASS.

### Proposed, not implemented (larger, or a product call)

| # | Sev | Finding | Proposal | Effort |
|---|---|---|---|---|
| P1 | **High** | **The timeline cannot be made taller.** There is a resize separator for the side panel and one for the inspector, but none between the preview and the timeline. At 1920×1080 the preview takes about 75% of the height and only 4 tracks fit (`audit-wide-1920.png`). Every NLE lets the user trade viewer for timeline. | Put a vertical separator on the existing `components/ui/resizable.tsx` between Preview and Timeline, persisted like the others. | S–M |
| P2 | Medium | **The Export dialog puts its primary action in the body, bottom-left, and the footer holds only "Close"** (`audit-export-dialog.png`). HIG and Fluent both place a dialog's primary action at the trailing end of the footer, beside Cancel. | Split `ExportForm` so the dialog passes Export and Cancel to `Modal`'s `footer`. The side-panel variant keeps its inline button. | M |
| P3 | Medium | **White on the accent is 3.15:1**, which fails AA for the 12px "Export" and every primary button. | This is a brand decision, so it is not changed here. Options: a button-only accent of **#b8561f** (white 4.78:1, and already the light theme's accent), or dark ink on the current accent (5.7:1). | S |
| P4 | Medium | **Signed controls fill from the left** (Tint, Temperature, Lift/Gamma/Gain, Hue), so the bar reads as an amount when the value is a direction. | Material 3's **centered slider**: fill from the identity point. That means an `origin` prop on `Slider`. | S |
| P5 | Medium | **"Saturation" appears twice**, in Adjustments (a CSS `saturate()` filter) and in Grade (a GPU grade). They are two controls with different maths under the same word (NN/g #4). | Rename the Adjustments control ("Saturate · filter"), or fold Adjustments into Grade once Grade covers blur/sepia/invert. | S / L |
| P6 | Low | **Timecodes are ambiguous.** "0:02:10" reads as h:mm:ss but means 2 s + 10 frames, and the inspector shows "0:20" in Source and "0:20:01" in Timing. | Separate frames visibly (for example `0:02;10` or `0:02 +10f`) and use one format per surface. `formatTimecode` is also used by tools, so this needs care. | S–M |
| P7 | Low | **A marker pin covers the ruler's timecode label** ("0:05" in `timeline-before.png`). | Nudge the label, or draw the pin below the label band. | S |
| P8 | Low | **Track order is V1, A1, V2, Captions**: added tracks append, so audio ends up between video layers. NLE convention stacks video upward and audio downward. | Order tracks by kind in the header column and lanes, as a display order over the model's order. | M |
| P9 | Low | **"Unsaved changes" is a button (it saves) that looks like status text.** | Keep it as text, give it a hover affordance and a "Save ⌘S" tooltip. | S |
| P10 | Low | **The subtitle-design thumbnails in the Text panel crop their own sample text** ("…u are an overthink"). | Fit the sample to the tile, or use shorter sample words. | S |
| P11 | Low | **The modal backdrop is 55% black**, so the bright preview competes with the dialog. | 65–70%. | S |
| P12 | Low | **The keyboard lacks NLE staples: no J/K/L shuttle, no I/O marks.** See `editor-features.md` #5. | — | S–M |

### Found in passing, outside the UI

- **A failed import stays cached in main until restart.** `importPaths` caches by path (`byPath` in
  `src/main/media/import.ts`), including assets that carry an `error`. Once a file has failed to probe, fixing or
  replacing it and importing again returns the same broken asset. The refusal text says "Re-importing will not
  help — the file itself is the problem", which is false once the file has been fixed. The fix is not to cache
  errored assets, or to call `forgetPath` when a probe fails. Not changed here because it is main-process media
  code.
- **`test/app/menu.mjs` is not isolatable.** It drives macOS menus through System Events on "the first process
  named Electron that owns a menu bar". It does not look at `PORT`. During this audit it found and drove
  **another agent's instance** (`--user-data-dir ~/.bay-wt/gym`, port 9250). It clicked File menu items there,
  and "Save As…" opened a sheet on that instance before the probe pressed Escape. The other instance's owner
  should check it. The probe should select the process by the `--remote-debugging-port` in its arguments. It
  was not re-run.

## Surfaces captured

**Before/after pairs** (same size, same state):
- `editor-audio-selected`
- `inspector-video-top` and `inspector-video-bottom` (captured at a 1440×2600 viewport so the whole inspector
  fits)
- `timeline`
- `media-panel`
- `panel-effects`
- `focus-select`
- `settings`
- `narrow-1024`

**Audit-only:**
- `audit-home-empty`
- `audit-export-dialog` (Loudness row included)
- `audit-panel-agent`, `audit-panel-text`, `audit-panel-templates`, `audit-panel-export`
- `audit-composer-menus` (the `/` skills menu and the `@` pins menu)
- `audit-light-theme`
- `audit-wide-1920`

**Not captured:**
- **The loading state** (import in progress). Imports of local files finished in under a second.
- **The home screen with projects listed.** Going home from an unsaved project would have needed a save or a
  discard, and `projects-home.mjs` covers that screen.

## Sources

- [W-CM] WCAG 2.2 Understanding 1.4.3: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- [W-FA] WCAG 2.2 Understanding 2.4.13 Focus Appearance (AAA; 2 CSS px perimeter, 3:1 change): https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- [W-LB] WCAG 2.2 Understanding 3.3.2 and 2.5.3: https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html · https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html
- [NNG-10] NN/g, 10 Usability Heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- [NNG-P] NN/g, Proximity principle: https://www.nngroup.com/articles/gestalt-proximity/
- [FL-L] Fluent 2, Layout (4px base unit, alignment): https://fluent2.microsoft.design/layout
- [M3-S] Material 3, Sliders guidelines (value readout or paired field; centered sliders): https://m3.material.io/components/sliders/guidelines
- [HIG-L] Apple HIG, Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- [HIG-S] Apple HIG, Sliders: https://developer.apple.com/design/human-interface-guidelines/sliders

The contrast ratios were computed with the WCAG relative-luminance formula against bay's own tokens in
`styles.css`. The HIG pages would not render through the fetcher, so they are cited for their general guidance
only, and no finding rests on them alone.
