# Colour, look and texture

Why a frame reads "cheap" even when the layout and the motion are right, and the small set of
treatments that fix it.

---

## 1. Declare a palette before writing anything

The commonest colour failure in agent-authored video is not a bad palette — it is **no
palette**: colours invented per element, so nothing relates to anything.

- **One background, one foreground, one accent**, declared up front, held across every scene.
- **One accent hue.** Used scarcely — one element per scene, always *the point*.
- **Match light/dark to the content.** Food, wellness, kids → light. Tech, cinema, finance →
  dark.
- **Tint the neutrals toward the accent hue.** Even a subtle warmth or coolness beats dead
  grey. Pure `#000` / `#fff` is an AI tell; it reads as a default, not a decision.
- Deriving in OKLCH is the cleanest method: pick a hue, build bg/fg/accent at different
  lightnesses, tint everything toward that hue.

### Lazy defaults to question

Each of these is the first thing a language model reaches for. Using one is fine; *defaulting*
to one is the tell.

- Gradient text (`background-clip: text` + gradient)
- Left-edge accent stripes on cards
- Cyan-on-dark, purple-to-blue gradients, neon accents
- Pure `#000` / `#fff`
- Identical card grids (same-size cards repeated)
- Everything centred with equal weight

### Palette families worth naming

Bold/energetic (launches, social) · warm/editorial (storytelling, documentary) · dark/premium
(tech, finance, luxury, cinematic) · clean/corporate (explainers, tutorials) · nature/earth
(sustainability, organic) · neon/electric (gaming, nightlife) · pastel/soft (fashion, beauty,
wellness) · jewel/rich (luxury, events) · monochrome (dramatic, typography-led).

---

## 2. Grading — why footage looks flat

"Flat" almost always means one of two things:

1. **Weak contrast** — no clear separation between shadows, midtones and highlights.
2. **Muted or uneven colour** — saturation either lifeless or inconsistent shot to shot.

A **LUT** (look-up table) maps one set of colours to another. A *technical* LUT converts a log
or camera-native image to a standard display space; a *creative* LUT applies a style — warm
document, cold urban shadow, vintage response, blockbuster contrast curve.

**A LUT is not a rescue.** If the base image is off, a LUT exaggerates the problem instead of
fixing it. Professional grading is exposure and white balance first, then the look, then a few
manual adjustments — not a creative LUT dropped on a bad image.

For generated/composited motion graphics the relevance is different but real: **a grade applied
uniformly across every shot is what makes a sequence feel like one piece.** Twenty clips each
dialled by hand drift apart; one look applied to all twenty does not.

---

## 3. The texture stack — what actually makes it look expensive

This is the highest-leverage, least-implemented category. A film-overlay stack is a **blend
stack where each layer owns exactly one job**:

| Layer | Job | Typical implementation |
|---|---|---|
| **Base** | the composited image | — |
| **Tint / grade** | unify the colour of everything | LUT or a curve, applied to the whole frame |
| **Grain / noise** | break up digital cleanliness | a noise texture, blended, very low opacity, animated so it doesn't read as a static overlay |
| **Vignette** | direct the eye inward, imply a lens | a radial darkening at the edges, subtle |
| **Bloom / glow** | imply real light with real falloff | bright areas bleeding into their neighbours |
| **Light leak** | organic warmth, a seam accent | a soft off-frame source with exponential falloff |

**Grain is the single most cost-effective one.** Perfectly clean digital frames read as
synthetic; a small amount of animated grain reads as *photographed*. It is why grain and grunge
texturing on shapes became standard practice in motion design — it is not nostalgia, it is
anti-uncanny.

**Vignette** is second: it tells the eye where to look and implies a lens was involved.

**Bloom/glow** is what makes a bright element read as *emitting light* rather than as a bright
rectangle. Without it, a neon accent is just a saturated fill.

Other texture sources: scan lines, halftone/dither, frosted-glass panels, chromatic aberration
at the frame edges, subtle paper or fabric grounds.

**Caveat:** these are seasoning. Grain at 15% opacity is a look; grain at 60% is a filter. A
vignette you can *see* is too strong.

---

## 4. Blend modes as a design tool

Blend modes are not just for compositing footage — they are the mechanism behind most texture
work:

- **Multiply / colour-burn** — grain, shadow, dirt; darkens and keeps highlights.
- **Screen / plus-lighter / colour-dodge** — glow, light leaks, sparks; brightens and keeps
  blacks.
- **Overlay / soft-light** — contrast and tint layers that preserve luminance structure.
- **Difference / exclusion** — inversion effects, glitch accents.
- **Hue / saturation / colour / luminosity** — recolouring one layer with another's colour
  while keeping its detail. This is how you tint an image to the palette without flattening it.

A frame built from three layers with three blend modes reads as composited. A frame built from
three layers all at `normal` reads as a slide deck.

---

## 5. The background layer

Every scene needs persistent decorative structure so it is not empty while the content
staggers in. Mix 2–5 per scene:

- Radial glows, accent-tinted, low opacity
- Ghost type — theme words at 3–8% opacity, very large, bleeding off frame
- Hairline rules and dividers
- Grain / noise overlay
- Geometric shapes, grid patterns
- Thematic decoratives (orbit rings for space, grooves for music, grid lines for data)

Decoratives should have slow ambient motion *as a group* — one shared drift or breath, not
independent motion per element (which reads as chaos, and violates the "no lazy breathing"
rule if applied to content).

**Note the distinction:** 2–5 decorative *elements* sharing *one* ambient behaviour. A scene
with four decoratives and one shared breath is correct; a scene with one decorative is
under-dressed; a scene with four independent floating things is noise.

---

## 6. Style systems — colour and motion travel together

A useful pattern from the surveyed tools: a named "style" binds palette, type, spacing, motion
energy, easing set, durations, atmosphere layers **and** a signature transition into one token
block. The point is that these choices are not independent — a luxury palette with snappy
0.2 s entrances is incoherent, and so is a punk palette with 1.2 s glides.

Worked examples of the coupling:

| Style | Palette | Motion | Atmosphere |
|---|---|---|---|
| **Swiss / clinical** | near-black, one blue accent, no rounding | `expo.out` entries, 0.4 s, hard cuts, nothing floats | grid lines, registration marks |
| **Premium / timeless** | deep black, thin type, wide tracking, generous space | `sine.inOut`, 1.2 s entrances, 3 s holds, nothing snaps | subtle grain, hairline rules |
| **Industrial / raw** | near-black + hot orange, zero radius, tight spacing | 0.3 s, stepped exits, slam and shatter | scan lines, glitch artifacts, grain |
| **Maximalist type** | black + saturated red/yellow, type at 8 rem | 0.3 s entrances, 0.8 s holds, no static moments | type layers, colour blocks |
| **Futuristic / immersive** | near-black + purple/cyan, thin weightless type | `sine.inOut`, 1.0 s, continuous morphing, nothing hard | particle field, light traces, radial glow |
| **Intimate / warm** | cream ground, humanist serif, soft radii | slow drifts, 1.0 s in, 3 s holds, never snaps | soft gradient, warm grain |
| **Dark / cinematic** | deep black, cold greys, one blood accent | `power3.out` in, `power4.in` out, slow creeping pushes | deep shadow, vignette, grain |

The lesson for bay: a "look" should not be only a LUT. A **preset** should carry palette + type
+ durations + easing + atmosphere so choosing one makes a coherent set of decisions at once.

---

## Sources

- [What is a LUT? Ultimate Guide to Color Grading — StudioBinder](https://www.studiobinder.com/blog/what-is-lut/)
- [A Complete Guide to Look-Up Tables — Pixflow](https://pixflow.net/blog/a-complete-guide-to-understanding-look-up-tables-in-video-editing-and-photography/)
- [Color Grading vs LUTs: what is the difference? — Envato](https://elements.envato.com/learn/color-grading-vs-luts-what-is-the-difference)
- [Why Using A Film Grain Overlay Makes Digital Footage Look Natural](https://www.capcut.com/resource/grain-overlay)
- [CSS Film Overlay Compositing with mix-blend-mode](https://animationpatterns.art/animations/film-overlay-compositing/)
- [Apply grain noise texture in After Effects — LinkedIn Learning](https://www.linkedin.com/learning/motion-graphics/apply-grain-noise-texture-in-after-effects)
- Encoded practice: `~/.claude/skills/hyperframes-creative/references/visual-styles.md`,
  `~/.claude/skills/hyperframes-creative/references/house-style.md`
