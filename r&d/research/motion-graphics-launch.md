# Motion graphics for launch films: what works, and what bay can do

Researched on 2026-09-27 for the RedAssay Attest film (see `../case-studies/redassay-attest/`).
The v1 film followed `apple-launch-style.md` literally and came out **too plain**: static crops, fades,
and one slow push per shot. This note is what changed for v2, and why.

## What the sources say

Sources: [Advids: 30 launch video breakdowns](https://advids.co/blog/30-top-motion-graphics-launch-video-examples-to-ignite-curiosity) ·
[ngram: launch video playbook 2026](https://www.ngram.com/blog/product-launch-video-complete-playbook-2026) ·
[SVGator: motion design tips](https://www.svgator.com/blog/motion-graphic-design-tips-and-tricks/) ·
[Advids: animated SaaS feature demos](https://advids.co/blog/animated-saas-feature-demo) ·
[FocuSee: SaaS demo video guide](https://note.com/focusee/n/na3e446d327eb?hl=en).

Advids' sample was 7 launch films, so its percentages are indicative rather than statistical.

| Technique | Evidence | Rule we took |
|---|---|---|
| **Cursor mechanics** | 71% used "hyper-smoothed, bezier-curved cursor paths that snapped magnetically to UI buttons"; the rest used no cursor and autonomous UI pulses | A visible cursor on curved paths that clicks real buttons, with a press animation and a ring |
| **Z-axis / depth of field** | 57% "weaponized the Z-axis and depth-of-field blur to isolate active features" | 3D tilts of the whole UI, and a focus pull: blur and dim everything but the active element |
| **Continuous camera** | 71% preferred "continuous, unbroken camera pans, sliding from one UI quadrant to the next without a single cut" | Pan within a take from the list to the ring, instead of cutting |
| **Z-push through UI** | Zendesk/Figma push through a button into the next view; Airtable/Miro pan an isometric canvas | Planned; not yet built in our tooling |
| **Time compression** | 71% "collapsed multi-step workflows into instantaneous cascades" | Three rapid clicks (~0.75 s apart), then the result |
| **Tactile sound** | 85% anchored UI changes to "localized, tactile sound effects" | A click SFX on every press, an impact on reveals, a bell on the payoff |
| **Exponential cut acceleration** | 85% ended faster than they started: 3 s holds early, 0.5 s cuts in the last 5 s | A 0.5–0.6 s montage on consecutive beats before the close |
| **UI early** | Show UI by 0–2 s for cold traffic; delayed reveal is acceptable for warm audiences | **We missed this:** UI first appears at 7.3 s in v2. Fix in v3 |
| **Hook** | First 5 s decide; state the problem, not a logo (ngram) | Problem line first ("Your first enterprise deal wants SOC 2.") |
| **3–5 features, one CTA, under 90 s** | Advids, ngram | 5 feature beats, 60 s |
| **Kinetic type** | Pair text reveals with UI interactions; show impact, not feature lists | Per-word blur-in, a red key word, a red strike-through drawn across "spreadsheet" |
| **3D vs 2D zoom** | "a true 3D scene shifts perspective like a real lens, while a 2D zoom scales pixels and reads as flat" | Bake the 3D into the footage; use bay's 2D keyframes on top as drift |

## What bay can and cannot do (2026-09-27)

Mapped from the source; see `src/shared/project.ts`, `src/shared/tools/*`, `src/main/mcp/docs/brf.md`.

- **Clip camera is 2D only.** Keyframes animate `opacity, left, top, width, height, rotation, scale,
  volume`. Eases are `linear|hold|in|out|inOut` or a cubic-bezier `[x1,y1,x2,y2]`. Scale and rotation are
  always about the clip centre (there is no anchor), so aiming a push means keyframing `left`/`top` too.
- **Clip looks are limited.** `crop` is static (not keyframable). There is no shadow, corner radius or 3D on
  clips. `blendMode` has 16 modes. Adjustments and grade values are not keyframable.
- **Transitions** are `cross-dissolve, dip-to-black, dip-to-white, wipe, push, slide, iris`. There is no
  zoom or whip.
- **`.brf` motion graphics** draw `rect, ellipse, path, text, group` with `x, y, anchor, rotate, scale,
  opacity, blur, shadow`. Entrance/exit presets are `fade, up, down, left, right, pop, grow, wipe, blur,
  type`. Text splits by `word|char|line` with a stagger, and easings include `outExpo, outBack, spring`. A
  `.brf` cannot draw an image or video; masks are rectangular only.
- **Real 3D, masks or video inside a graphic** require an HTML composition (`write_composition`, CSS 3D,
  GSAP copied next to the file, media inside the composition's folder).
- **Speed** is constant only (no ramps). The agent has no freeze-frame tool (the UI has one). There is no
  motion blur.

## The workaround we used: bake the camera into the footage

We record the product UI in a browser and inject `../tools/film.js`:
- **Cursor:** moves on curved paths and clicks real buttons (`click`).
- **Camera:** `shot()`/`cut()` aim a 3D transform at an element, with perspective, tilt and scale about
  its centre.
- **Focus pull:** `focus()` blurs and dims everything except the target.

The recording is 4K, so bay can crop to 150–200% and stay sharp. bay's agent then adds the edit, kinetic
type, 2D drift, SFX and music. The per-shot choreography is in `../tools/takes.js`.

## Open items for v3

- **Show UI inside 2 s:** open on the tilted UI with the hook over it.
- **Make the cursor read at 1080p:** it is too small. bay's agent proposed a click-ring overlay or a push
  on each click.
- **Build the Z-push** through a button into the next view (CSS 3D translateZ in `film.js`).
- **Check the mix by ear:** nobody has listened to the SFX levels.
