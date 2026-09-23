> **Historical:** describes the Rust engine, deleted; recover what it cites with `git show rust-engine-final:dep/rust/<path>` (e.g. `crates/bay-mcp/src/tools.rs`).

# 39 — Assets: the difference between typography-on-a-field and a made thing

Round 2. Every command in this file was **run on this machine** (macOS 26.5.2, ffmpeg 8.1.2,
Apple silicon) and every number was measured. Where something failed, it says so.

**Headline:** macOS already ships an unbounded offline asset factory — 8,302 SF Symbols with a
searchable synonym index, and a full SVG rasteriser reachable from `/usr/bin/sips`. Neither
needs a download, a network call, or a homebrew package. bay has no tool that reaches either,
the skill never tells the agent an asset can be *made*, and `check.rs:1195` explicitly returns
`Vec::new()` for every `Image`/`Video` element — so the one axis that separates both reference
videos from all four of ours is the one axis the software is blind to on purpose.

**Second headline, and the more expensive one:** I tested five candidate *frame-statistic*
metrics for "is this a made thing" (ink coverage, chromatic breadth, top-8 colour coverage,
modal-colour coverage, gradient energy). **All five fail.** On four of them the good reference
(R2) scores *worse* than `wicks-v2`. Do not build a pixel-statistics asset check; §8 has the
numbers, and §9 has the project-model rule that does separate them cleanly (0 vs 2–40, no
overlap).

---

## 1. Asset classes ranked by perceived-quality-per-unit-work

Ranked for a 60 s vertical explainer made by an agent, on this machine, offline.

| # | Class | Cost here | What it buys | Risk / when it is wrong |
|---|---|---|---|---|
| 1 | **Authored vector (SVG → PNG)** | 0.27 s/asset, `sips`, zero deps (§5) | Unbounded. Diagrams, real charts, arrows, annotation, brand marks, illustration. The only class where the asset can be *about the subject* | Wrong when it becomes "a rectangle with rounded corners" — i.e. when the agent re-invents `add_shape` in SVG. Rule: if it can be drawn with ≤3 rects it is not an asset |
| 2 | **SF Symbols icons** | 0.51 s/asset, one AppKit call (§3) | 8,302 marks, any size, any colour, hierarchical 2-tone. Instantly kills "text on a field" | Stock-icon syndrome: the same 6 rounded glyphs every tech video uses (`bolt.fill`, `brain`, `lock.shield`, `chart.line.uptrend.xyaxis`). Wrong when the icon merely *decorates* a word it duplicates |
| 3 | **Screen capture (`screencapture`, real UI)** | 0.02 s, but needs a screen with the thing on it (§7) | The highest-credibility class. R1 is 42.2% of frame area screen capture and its whole argument is "here are the receipts" | Wrong when there is no product to show. Needs Screen Recording permission; a denied prompt is a silent black frame |
| 4 | **Procedural backplate** | 0.06–0.22 s per 1080×1920 PNG (§4) | Stops the ground being flat. Cheapest single change in the list | Stock-gradient syndrome: the purple/teal mesh blob every AI app ships. Wrong when it competes with the content — a backplate must be invisible on first look |
| 5 | **Real logos from app bundles** | 0.02 s, `sips` on `.icns` (§6) | Real brand marks, offline. R2's whole credibility trick — crayon world, photoreal logo | Only covers software installed on this machine. Trademark: editorial/commentary use is what R2 does; never imply endorsement |
| 6 | **Photographs (user's own `~/Pictures`)** | free | Continuous tone, real light. The one class primitives cannot fake | Requires the user's consent and knowledge of what is in them. Never reach into a personal photo library unasked |
| 7 | **Textures / grain / paper** | 0.22 s (§4) | Depth under type. Turns `#0E0E12` into a surface | Nearly free, nearly always right at ≤6% strength; wrong above that, where it reads as compression noise |
| 8 | **Emoji** | 0.1 s via Pillow (§7) | Colour and a recognisable object with zero authoring | The skill already bans it (`banned-defaults.md:86`) and is right: reads as a chat message. Only defensible at ≥400 px as a deliberate flat-graphic device, and even then rarely |
| 9 | **3D renders** | not available | — | No renderer, no models. Skip |
| 10 | **Generated imagery (SDXL-Turbo)** | weights are on disk (2.8 GB) but no runtime (§12) | Photographic-looking fill | **Worst class for this problem.** Generated imagery is the single most legible "AI made this" signal in the frame. It is the aesthetic the manifesto positions against. Option, never a default |
| — | **Stock footage / stock library** | not available offline | — | Would need a download the user must ask for; and stock-footage syndrome is a named failure mode. Skip |

**The counter-intuitive part.** Assets do not *add* complexity — they collapse it. `wicks-v2`
has 188 elements and 0 imported pictures. R1 has **3 elements** (tweet PNG, screen-recording
MP4, one caption line) and 42.2% of its frame is real content. The candlestick chart in §5 is
**one** image element; built from `add_shape` it is 42 elements and 42 animation channels — and
28 of the 76 three-frame pops in `wicks-v2` exist because a chart was assembled from primitives.
**An asset pipeline is also the move-count fix.**

---

## 2. What is actually available on this machine — verified

| Source | Binary | Ships with macOS? | Measured | Verdict |
|---|---|---|---|---|
| SF Symbols → PNG | `swift` + AppKit | Symbols yes (`CoreGlyphs.bundle`); `swift` needs Xcode CLT | 8,302 names; 0.51 s compiled, 1.23 s interpreted | **Use.** Better: do it in-process, `objc2-app-kit` is already in `rust/Cargo.lock:4246` |
| SVG → PNG | `/usr/bin/sips` | **yes** | 0.27 s for 1080×1080; paths, gradients, masks, clipPath, filters, CSS classes, text, transforms all render (§5) | **Use. Biggest unlock in this file** |
| Procedural backplates | `ffmpeg` | no — bay provisions it | 0.06 s gradient, 0.09 s blobs, 0.22 s grain+vignette, all 1080×1920 | **Use** |
| App icons → PNG | `/usr/bin/sips` on `.icns` | **yes** | 0.017 s, 512 px, alpha intact | **Use** for tech subjects |
| Screen capture, still | `/usr/sbin/screencapture` | **yes** | 0.02 s; `-R 0,0,600,400` returned 1200×800 (2× backing scale) | **Use** when there is a screen worth showing |
| Screen capture, **video** | `screencapture -v -V<sec>` | **yes** | 3.008 s H.264 3024×1964 written non-interactively | **Use.** Closes R1's "live typing" ceiling outright |
| Emoji → PNG | Pillow `embedded_color=True` on `Apple Color Emoji.ttc` | font yes, Pillow no | works, 256 px | Available; mostly should not be used |
| HTML → PNG | Chrome `--headless --screenshot` | no (Chrome) | 2.9 s, transparency via `--default-background-color=00000000` | Fallback only. 10× slower than `sips`, and a dependency bay cannot assume |
| SVG → PNG | `rsvg-convert`, `magick` | **no** (homebrew) | works | Do not build on it |
| Charts | matplotlib | **not installed** | — | Not needed; §5 emits SVG directly |
| Generated images | SDXL-Turbo weights present, `diffusers`/`torch`/`mlx` absent | — | 2.8 GB on disk, unusable | §12 |

---

## 3. SF Symbols — verified end to end

**The catalogue ships with macOS and is machine-readable.**

```bash
plutil -convert json -o - \
  /System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources/symbol_order.plist
# → JSON array, 8302 names: "square.and.arrow.up", "chart.line.uptrend.xyaxis", …

plutil -convert json -o - \
  /System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources/symbol_search.plist
# → 3189 entries of name → synonyms, e.g. "number": ["#","hash","octothorpe","pound"]
#   This is an offline keyword→icon search index. Also: categories.plist, symbol_categories.plist
```

**Rasterising one, with colour and weight** (`sfsym.swift`, 38 lines, whole file below):

```swift
import AppKit
// sfsym NAME SIZE #HEX OUT.png [weight]
let a = CommandLine.arguments
let name = a[1], size = CGFloat(Double(a[2])!), out = a[4]
func color(_ h: String) -> NSColor { var s=h; if s.hasPrefix("#"){s.removeFirst()}
  var v: UInt64 = 0; Scanner(string:s).scanHexInt64(&v)
  return NSColor(srgbRed: CGFloat((v>>16)&255)/255, green: CGFloat((v>>8)&255)/255,
                 blue: CGFloat(v&255)/255, alpha: 1) }
guard let img = NSImage(systemSymbolName: name, accessibilityDescription: nil) else { exit(3) }
let cfg = NSImage.SymbolConfiguration(pointSize: size, weight: .bold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [color(a[3])]))
let conf = img.withSymbolConfiguration(cfg)!
let s = conf.size, w = Int(ceil(s.width)), h = Int(ceil(s.height))
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = s
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
conf.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1.0)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
```

```bash
swiftc -O sfsym.swift -o sfsym            # 1.3 s, once
./sfsym chart.line.uptrend.xyaxis 512 "#FF5B5B" icon.png bold
# → icon.png 695x583, hasAlpha: yes, corner pixel RGBA = 00 00 00 00 (real transparency)
# → 0.51 s wall
```

Verified: the PNG composited over `#0E0E12` renders a clean red chart glyph. A bad name exits
non-zero with `no such symbol: candlestick` — the agent gets a real error, not a blank asset.

**Colour modes** (all verified, `sfsym2.swift` in the scratchpad):

| Mode | Config | Result |
|---|---|---|
| Monochrome | `.paletteColors([c])` | flat fill in `c` — correct |
| **Hierarchical** | `.hierarchicalColor(c)` | two tones derived from `c`. `cloud.sun.rain.fill` rendered as a 2-tone purple. **This is the one to default to** — it gives depth for free |
| Palette | `.paletteColors([a,b,c])` | per-layer colours; single-layer symbols use only the first |
| Multicolour | `.preferringMulticolor()` | **trap**: base layer takes the default label colour = black, so on a dark ground you get a black icon with one coloured badge. Never use without an explicit base tint |

### 3a. The defect that must be handled: dark edge fringing

`NSBitmapImageRep` writes RGB `(0,0,0)` into every fully transparent pixel — measured:
288,260 transparent pixels in `icon.png`, mean RGB `0.0, 0.0, 0.0`. bay samples textures with
`FilterMode::Linear` (`bay-gpu/src/context.rs:81-82`) and composites **straight** alpha
(`blend.wgsl:136-139`, `out_rgb = (1-la)*base + la*(...)`). Straight-alpha linear filtering
interpolates that black across the edge:

```
icon fill #FF5B5B over ground #EDECE6, bilinear midpoint of an edge pixel pair:
  transparent RGB = black (what we get) : [182.2 140.8 137.8]   ← 64/255 too dark on R
  correct (premultiplied)               : [246.0 163.5 160.5]
  transparent RGB = flooded with fill   : [246.0 163.5 160.5]   ← exact, error 0
```

**Every imported transparent PNG gets a dark halo, up to 25% of range at the edge.** Two fixes:

- **Today, no engine change:** flood the RGB channel with the icon's fill colour, keeping alpha.
  Exact for single-hue icons (error 0.0 above). `--flood` in `sfsym2.swift`, or
  `ffmpeg -i in.png -vf "format=rgba,geq=r=255:g=91:b=91:a='alpha(X,Y)'" out.png`.
- **Properly:** premultiply on upload in `ensure_image_texture` (`bay-preview/src/lib.rs:1287`)
  and switch `blend.wgsl` to premultiplied source-over. See §11.

Second defect, unfixable by the agent: `mipmap_filter: MipmapFilterMode::Nearest` with no mip
chain. A 700 px icon shown at 200 px is minified 3.5× through a single-level bilinear tap — it
will alias and crawl under motion. **Practical rule until mips exist: render the symbol at
1.0–1.4× its on-screen pixel size, never 3×.**

---

## 4. Procedural backplates — working commands, all producing 1080×1920 PNG

All verified. Timings measured on this machine.

```bash
# 1. Two-stop linear gradient                                            0.06 s
ffmpeg -y -f lavfi -i "gradients=s=1080x1920:c0=0x0E0E12:c1=0x1B1B2B:\
x0=0:y0=0:x1=1080:y1=1920:type=linear" -frames:v 1 bp_linear.png

# 2. Off-centre radial glow  (x0,y0 = centre; x1,y1 sets the radius)     0.06 s
ffmpeg -y -f lavfi -i "gradients=s=1080x1920:c0=0x2A2140:c1=0x0B0B10:\
x0=540:y0=620:x1=540:y1=1920:type=radial" -frames:v 1 bp_radial.png

# 3. Gradient + film grain + vignette   ← the default. Use this one.     0.22 s
ffmpeg -y -f lavfi -i "gradients=s=1080x1920:c0=0x14141C:c1=0x0A0A0E:x0=0:y0=0:x1=200:y1=1920:type=linear" \
  -vf "noise=alls=9:allf=t+u,vignette=PI/4.2,format=rgb24" -frames:v 1 bp_grain.png

# 4. Dot field, 60 px pitch                                             0.10 s
ffmpeg -y -f lavfi -i "color=c=0x0E0E12:s=1080x1920" -vf \
"geq=r='if(lt(hypot(mod(X,60)-30,mod(Y,60)-30),2.2),40,14)':\
g='if(lt(hypot(mod(X,60)-30,mod(Y,60)-30),2.2),40,14)':\
b='if(lt(hypot(mod(X,60)-30,mod(Y,60)-30),2.2),52,18)'" -frames:v 1 bp_dots.png

# 5. Rule grid, 90 px pitch                                             0.10 s
ffmpeg -y -f lavfi -i "color=c=0x0B0B10:s=1080x1920" -vf \
"geq=r='if(lt(mod(X,90),1)+lt(mod(Y,90),1),28,11)':\
g='if(lt(mod(X,90),1)+lt(mod(Y,90),1),28,11)':\
b='if(lt(mod(X,90),1)+lt(mod(Y,90),1),38,16)'" -frames:v 1 bp_grid.png

# 6. Two soft colour blobs (aurora) — tune the /180000 to change radius  0.09 s
ffmpeg -y -f lavfi -i "nullsrc=s=1080x1920" -vf \
"geq=r='12+92*exp(-(pow(X-260,2)+pow(Y-420,2))/180000)+38*exp(-(pow(X-880,2)+pow(Y-1380,2))/220000)':\
g='12+34*exp(-(pow(X-260,2)+pow(Y-420,2))/180000)+70*exp(-(pow(X-880,2)+pow(Y-1380,2))/220000)':\
b='16+120*exp(-(pow(X-260,2)+pow(Y-420,2))/180000)+96*exp(-(pow(X-880,2)+pow(Y-1380,2))/220000)',\
gblur=sigma=40,noise=alls=7:allf=t" -frames:v 1 bp_blobs.png

# 7. Scanline / halftone texture                                        0.08 s
ffmpeg -y -f lavfi -i "color=c=0x101014:s=1080x1920" -vf \
"geq=r='14+10*sin(Y/3.0)':g='14+10*sin(Y/3.0)':b='20+12*sin(Y/3.0)'" -frames:v 1 bp_scan.png

# 8. Diagonal light sweep + grain  ← used in the proof frame, §10        0.12 s
ffmpeg -y -f lavfi -i "color=c=0x0A0A0F:s=1080x1920" -vf \
"geq=r='10+34*exp(-pow((X+Y-1500)/560,2))':g='10+28*exp(-pow((X+Y-1500)/560,2))':\
b='16+46*exp(-pow((X+Y-1500)/560,2))',noise=alls=6:allf=t,vignette=PI/4.6" -frames:v 1 bp_sweep.png

# 9. Paper ground (R2's blush canvas) + grain                           0.20 s
ffmpeg -y -f lavfi -i "color=c=0xFCF3F5:s=1080x1920" \
  -vf "noise=alls=5:allf=t,vignette=PI/5" -frames:v 1 bp_paper.png

# 10. Concentric rings / topographic                                    0.11 s
ffmpeg -y -f lavfi -i "nullsrc=s=1080x1920" -vf \
"geq=r='12+22*lt(mod(hypot(X-540,Y-760)/46,1),0.06)':\
g='12+22*lt(mod(hypot(X-540,Y-760)/46,1),0.06)':\
b='18+30*lt(mod(hypot(X-540,Y-760)/46,1),0.06)'" -frames:v 1 bp_rings.png
```

**Gotchas found the hard way.** `geq` has no `<` operator — use `lt(a,b)`. Boolean OR is `+`.
`gradients` `type=radial` takes `x0,y0` as the centre and `x1,y1` as a radius endpoint; my
first attempt produced a 200 px blob in the corner. This ffmpeg build has **no `drawtext`**
(no libfreetype) — do not plan to burn type with ffmpeg; use SVG (§5) or `add_text`.

**Ranked by risk of looking generic:** grid > dots > rings > sweep > grain-only > blobs. #6 is
the "every AI app ships this" gradient; #3 and #8 are almost invisible and almost always right.
`bay-effects` has no grain or vignette effect (`effect_add` types are
`brightness|contrast|saturation|blur|lut`), so a backplate must be an imported PNG — which is
fine, and needs no engine work.

---

## 5. SVG → PNG via `sips` — the largest unlock in this file

`/usr/bin/sips` rasterises SVG. It ships with macOS. It is not ImageIO —
`CGImageSourceCopyTypeIdentifiers()` returns 62 types and none is SVG; `strings /usr/bin/sips`
contains `public.svg-image` and `/System/Library/PrivateFrameworks/CoreSVG.framework` exists.
It works today on macOS 26.5; **the minimum macOS version is unverified** and worth pinning
before it becomes load-bearing.

```bash
sips -s format png in.svg --out out.png      # 0.27 s for 1080×1080, alpha preserved
```

Output pixel size = the SVG's `width`/`height` attributes exactly (600×600 → 600×600;
1200×1200 → 1200×1200). The agent controls resolution by writing the attribute — no resampling.

**Feature test, all rendered correctly** (`feat.svg`, composited over `#0E0E12` and read):

| Feature | Works |
|---|---|
| `<path>` with cubic béziers, `stroke-linecap`, `stroke-dasharray` | yes |
| `<linearGradient>` / `<radialGradient>` on fill and stroke | yes |
| `<mask>` (punched a hole through a rect) | yes |
| `<clipPath>` | yes |
| `<filter><feGaussianBlur>` | yes |
| `<style>` CSS classes | yes |
| `<text>` with `font-family`, `font-weight`, `letter-spacing`, `text-anchor` (Menlo, Helvetica Neue) | yes |
| `<g transform="rotate(…)">`, `rx` corner radii, `opacity` | yes |

Every one of these is a capability `10-capability-map-bay-vs-ideal.md` listed as a bay engine
gap — paths, gradients, animatable-parameter blur, strokes. **They are all available today, as
static assets, through a system binary.** They are not animatable, which is the honest limit:
an SVG asset is one texture, animated by bay's 7 transform channels. That is exactly what R2
does with 40 assets and one motion idea.

### A real chart in one element

```python
# emit candlestick SVG from OHLC data → sips → one add_image
bars = [(o,h,l,c), …]                       # 14 bars
lo, hi = min(b[2] for b in bars), max(b[1] for b in bars)
Y  = lambda v: H-pad-(v-lo)/(hi-lo)*(H-2*pad)
for i,(o,h,l,c) in enumerate(bars):
    x, col = pad+i*step+step/2, "#4ADE80" if c>=o else "#FF5B5B"
    svg += f'<line x1="{x}" y1="{Y(h)}" x2="{x}" y2="{Y(l)}" stroke="{col}" stroke-width="5" stroke-linecap="round"/>'
    svg += f'<rect x="{x-bw/2}" y="{Y(max(o,c))}" width="{bw}" height="{max(Y(min(o,c))-Y(max(o,c)),3)}" fill="{col}" rx="4"/>'
```

Rendered and inspected: a correct 14-bar candlestick chart, 1080×760, wicks and bodies, four
gridlines, red/green by direction. **0.3 s. One image element.** In `add_shape` primitives that
is 14 wicks + 14 bodies + 4 gridlines = 32 elements minimum, each needing its own `animate`
call, which is precisely the mechanism that produced 188 elements and 160 move onsets.

---

## 6. Real brand marks from installed apps

```bash
sips -s format png -Z 512 "/Applications/Docker.app/Contents/Resources/AppIcon.icns" --out docker.png
# 0.017 s, 512×512, hasAlpha: yes
```

Generic form when the `.icns` filename is unknown (works for every app, and for documents):

```swift
import AppKit                                   // swift icon.swift <path> <size> <out.png>
let img = NSWorkspace.shared.icon(forFile: CommandLine.arguments[1])
```

Verified: Docker and Slack marks extracted at 512 px with clean alpha, full colour, correct.
On this machine that is ~40 real marks (Chrome, Slack, Figma-adjacent, Notion, Docker, Ollama,
Telegram, Discord, WhatsApp, Android Studio, Cursor, …). This is R2's exact device — the
credibility of an unmodified real logo dropped into a drawn world. Trademark posture: R2's use
is editorial commentary about the companies; do the same and never imply endorsement.

---

## 7. Screen capture, emoji, HTML — verified but conditional

```bash
screencapture -x -t png -R 0,0,600,400 out.png     # 0.02 s → 1200×800 (2× backing scale!)
screencapture -x -o -l <windowid> out.png          # single window, no shadow
screencapture -x -D 1 out.png                      # whole main display

# VIDEO — verified. Round 1 assumed live UI had to be faked as still-image swaps. It does not.
screencapture -v -V 3 -x -D 1 rec.mov              # → 3.008 s, h264, 3024×1964, VFR container
screencapture -v -V 12 -x -k -l <windowid> rec.mov # one window, 12 s cap, click indicators
screencapture -v -g …                              # -g also captures default audio input
ffmpeg -i rec.mov -r 30 -vsync cfr -c:v libx264 -crf 18 rec30.mp4   # normalise VFR before import
```
Needs Screen Recording permission. A denied prompt yields a black or desktop-only image, not an
error — so any capture must be read back before it is placed. `-R` is in points; the file comes
back at backing scale, so ask for half the pixels you want. The `.mov` reports
`r_frame_rate=240/1` (variable) — normalise to CFR before `media_import`, or bay's decode
planning is working from a frame rate that does not exist.

```python
# Emoji → transparent PNG (Pillow; not a system dependency)
f = ImageFont.truetype('/System/Library/Fonts/Apple Color Emoji.ttc', 160)
im = Image.new('RGBA',(256,256),(0,0,0,0)); ImageDraw.Draw(im).text((10,10),'🕯️',font=f,embedded_color=True)
```
Works. The skill bans emoji-as-illustration and that ban should stand.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --screenshot=out.png --window-size=680,480 --default-background-color=00000000 \
  --hide-scrollbars file://$PWD/page.html      # 2.9 s, alpha preserved
```
Works, but 10× slower than `sips` and depends on a browser bay cannot assume. Only reach for it
when the asset genuinely needs HTML layout (flowing text, tables). Note `SKILL.md:3` currently
says *"Prefer bay over HTML/CSS/browser-screenshot pipelines"* — right about the **renderer**,
and it is being read as a ban on the **asset source**. Reword.

---

## 8. Negative results: five frame-statistic metrics that do NOT work

Sampled every 3 s at 270 px wide, all five videos. **Bold = the good reference doing worse than
the failure.**

| Metric | R1 (good) | R2 (good) | wicks-v2 (bad) | local-first (bad) | cand-wicks (bad) | Separates? |
|---|---|---|---|---|---|---|
| Ink coverage (round 1) | dense | 1.7–8.1% | 0.8–12.3% | 4.0–6.9% | 1.5–6.3% | **no** |
| Distinct hue buckets, ≥0.3% area each | 2 | **1** | 0 | 1 | 0 | **no** |
| Top-8 quantised colours' coverage | 89.0% | **97.6%** | 96.4% | 96.1% | 96.9% | **no** |
| Modal-colour coverage | 55.6% | **94.9%** | 60.6% | 89.5% | 92.6% | **no — inverted** |
| Mean \|gradient\| (tonal richness) | 10.11 | **3.01** | 5.47 | 9.12 | 4.54 | **no — inverted** |

R2 — flat blush ground, line art, 1.7–8.1% ink, one modal colour holding 94.9% of the frame —
is *by every pixel statistic* flatter, emptier and more monochrome than `wicks-v2`. The
difference between them is **semantic**: R2's marks are drawings of things; ours are rectangles.
No histogram can see that.

**Consequence: do not add a pixel-statistics asset check.** It will either pass `wicks-v2` or
fail the reference, and an agent optimising it will add noise textures and coloured confetti —
the exact Goodhart failure this round exists to prevent.

### The one measurement that does separate them, cleanly

| Video | Imported **visual** assets | Frame area from imported media | Source |
|---|---|---|---|
| R1 | **2** (1 PNG + 1 MP4) | **42.2%** (video window 36.6% + tweet card 5.6%) | measured band analysis at t=12 s |
| R2 | **~40** distinct | artwork bbox spans 58–72% of frame | counted from 1 fps + 2 fps contact sheets |
| wicks-v2 | **0** | **0.0%** | project JSON: 16 media, all `.wav`; 73 text + 46 shape |
| local-first | **0** | 0.0% | `12-video-teardowns.md` |
| cand-wicks / cand-vol | **0** | 0.0% | `12-video-teardowns.md` |

{2, 40} vs {0, 0, 0, 0}. No overlap, no threshold tuning, computable from the project model in
microseconds, and — critically — **unsatisfiable without going and getting a picture.**

---

## 9. The asset budget, measured

| | R1 | R2 | what it implies |
|---|---|---|---|
| Runtime | 39.3 s | 57.2 s | |
| Distinct imported assets | 2 | ~40 | |
| Assets per second | 0.05 | **0.70** | R2 introduces a new asset every ~1.4 s |
| Of which real logos | 1 (avatar) | **~14** (AltaVista, Lycos, Excite, Google, Uber, Lyft, Sidecar, OpenAI, Anthropic, Meta, Gemini, Llama, xAI, Perplexity) | |
| Character poses | 0 | ~6 stick-figure poses + globe-with-face | one recurring protagonist |
| Object drawings | 0 | ~20 (storefronts, docs, money bags, chalkboards, search bar, gavel, legal papers, bar chart, arrows, island) | |
| Total elements on the timeline | **3** | ~50 | vs `wicks-v2`'s **188** |
| Accumulation | fixed 3-zone frame, all change inside one window | 1 → 2 → 3 → 4 assets in consecutive seconds; **they stay** | measured directly from the 1 fps sheet |

**Two viable budgets, and they are opposite ends:**

- **R1 budget — 2 assets, one of them big and alive.** Works only when you have real footage or
  a real screen to show. Everything else is a fixed frame.
- **R2 budget — 0.6–0.8 assets/second, each small, each arriving on a narrated word and
  staying.** Works for anything. **This is the target for a bay explainer:** a 60 s video wants
  **35–45 distinct assets**, ~1 every 1.5 s.

For `wicks-v2`'s 8 topic beats: **4–6 assets per beat**, arriving one at a time across the beat,
accumulating. Not 23 text elements per beat.

---

## 10. The rules — and how each one would be gamed

Every rule states what an agent optimising *only* it would produce.

| # | Rule | Threshold | Checkable from | If gamed, the video is… |
|---|---|---|---|---|
| **A1** | `no-assets` — the project contains zero `Image`/`Video` elements | any project ≥15 s with 0 → **error** | project model | …forced to contain ≥1 picture. Gameable with one blank PNG → A3 |
| **A2** | `asset-starved` — scenes with no imported visual asset above the backplate | >40% of scenes → error | project model | …an asset in most scenes. Gameable by reusing one → A4 |
| **A3** | `hollow-asset` — an imported image whose own alpha/ink coverage is <8% or >92% of its bounding box | error | measured once at `media_import` | …importing pictures that are actually pictures. A solid rect fails (use `add_shape`); a near-empty PNG fails |
| **A4** | `asset-repeat` — two subject assets with 8×8 dHash Hamming distance <12/64 count as one | distinct subject assets < 0.6 × scene count → error | hash at import | …genuinely different pictures. Colour variants of one icon do not count |
| **A5** | **`type-is-the-subject`** — in each scene, the largest-area non-backplate visual element is `Text` or `Shape` | >40% of scenes → error | project model, element areas | …the *picture* carries each scene and type captions it. **This is the R2/R1 rule and the one that cannot be faked** |
| **A6** | `flat-ground` — the project background is a flat colour and layer 0 holds no full-bleed image in any scene | warning | project model | …one 0.2 s ffmpeg backplate. Cheapest true fix in the file |
| **A7** | `icon-minified` — an image element whose on-screen pixel size is <0.6× its source pixel size | warning | model + probed dimensions | …icons rendered near 1:1, so they stop crawling (until mips exist, §11) |
| **A8** | `asset-cadence` — assets per scene-second below 0.25 in a scene longer than 6 s | warning | project model | …assets spread through the scene rather than dumped at its head |

**Why A5 is the load-bearing one.** It is a *comparison*, not a count, so there is no number to
inflate. To satisfy it the agent must make the picture bigger than the headline in most scenes —
which is a composition decision it cannot make without having a picture worth enlarging. A
`wicks-v2` that satisfied A1–A8 could not be `wicks-v2`: it would have ≥5 scenes, ≥5 distinct
non-hollow pictures, each larger than its headline, on a non-flat ground.

**The residual hole, stated plainly.** Nothing above checks that the asset is *about the
subject*. An agent could import 40 unrelated pictures and pass. That hole is not closable by a
check; it is closable by the snapshot-and-read loop the skill already mandates. The rules make
"no assets" impossible and "wrong assets" visible; they cannot make "wrong assets" impossible.

### Proof frame

Left: `wicks-v2` at t = 19 s (the frame with the empty card and `"Different day."` occluded).
Right: built from three offline assets — `bp_sweep.png` (§4 #8, 0.12 s), one hierarchical
SF Symbol (§3, 0.51 s), and one SVG type block (§5, 0.27 s). **0.9 s of asset work, total.**
The right frame is unambiguously better and required no engine change and no download.
(Rendered and inspected at `…/scratchpad/side.png`.) It still has a dead bottom third — assets
do not fix layout, and nothing in this file claims they do.

---

## 11. The pipeline — what bay needs

### The tool: `asset_make`

One tool, four generators, returns a `mediaId` that `add_image` already takes. Everything below
was verified working in §3–§6; this is packaging, not research.

```jsonc
// asset_make — "make a picture and register it", replacing generate→write→media_import
{
  "kind": "icon" | "svg" | "backplate" | "appicon" | "screen",

  // kind=icon  — SF Symbols. 8302 names; call asset_search first.
  "symbol": "chart.line.uptrend.xyaxis",
  "color":  "#FF5B5B",            // hierarchical 2-tone by default; array for a palette
  "weight": "bold",
  "pixels": 700,                  // render at the on-screen size, not 3× it (§3a)

  // kind=svg   — the unbounded path. Agent writes the markup.
  "svg": "<svg xmlns=… width='1080' height='760'>…</svg>",

  // kind=backplate — the §4 recipes by name, not raw ffmpeg
  "recipe": "grain" | "sweep" | "dots" | "grid" | "rings" | "radial" | "blobs" | "paper" | "scanlines",
  "base": "#0E0E12", "accent": "#1B1B2B", "grain": 0.03,

  // kind=appicon — real marks from installed apps
  "app": "/Applications/Docker.app",

  // kind=screen — screencapture; must be read back before placing.
  // "seconds" > 0 switches to -v video capture and normalises VFR→CFR at the project fps.
  "rect": [0,0,600,400] | "window": 12345, "seconds": 0,

  "id": "icon-wick"
}
// → { mediaId, path, width, height, inkCoverage, dHash, warnings[] }
```

`inkCoverage` and `dHash` are computed here, once, which is what makes A3 and A4 free at check
time. `warnings` carries `"symbol not found — nearest: …"` and `"screen capture returned a
uniform frame; Screen Recording permission may be denied"`.

### The companion: `asset_search`

```jsonc
{ "query": "candlestick" }
// → reads symbol_search.plist (3189 synonym entries) + symbol_order.plist (8302 names)
//   + categories.plist, returns ranked matches. Purely local, no network, ~5 ms.
```
Without this the agent guesses symbol names and gets `no such symbol: candlestick` (measured —
that exact name does not exist; `chart.bar.xaxis` and `waveform.path.ecg` do).

### Implementation notes

- **`kind=icon` needs no subprocess.** `objc2-app-kit` is already in `rust/Cargo.lock:4246` via
  GPUI. `NSImage::imageWithSystemSymbolName` + `NSBitmapImageRep` is ~40 lines of Rust, and
  avoids depending on Xcode CLT being installed at runtime.
- **`kind=svg` must shell to `/usr/bin/sips`** — SVG is not in `CGImageSourceCopyTypeIdentifiers()`,
  so there is no ImageIO route. `/usr/bin/sips` is always present; this is not a provisioned
  runtime and must not be routed through `bay-provision`.
- **`kind=backplate` needs ffmpeg**, which bay already provisions. Degrade to a flat colour with
  a message, per the existing rule.
- **Nothing here downloads anything.** Every byte is already on the machine. This is the rare
  capability that is *more* aligned with the manifesto than the status quo, because it removes
  the only reason an agent would reach for a stock library.

### Skill changes required

| File | Change |
|---|---|
| `SKILL.md:3` | "Prefer bay over HTML/CSS/browser-screenshot pipelines" → clarify: bay is the renderer; SVG and screen capture are legitimate **asset sources** |
| `SKILL.md` step list | insert `asset_search` / `asset_make` between `fonts_check` and `add_*` — assets are gathered *before* the timeline is built |
| `banned-defaults.md:25-30` | already says "having something to place" and names no way to get it. Replace with the §2 table |
| `banned-defaults.md:86` | "Emoji and icon-font glyphs as illustration" — add that a 700 px hierarchical SF Symbol is not an icon-font glyph |
| new `references/assets.md` | §1 ranking, §3–§6 commands, §9 budget (35–45 assets per 60 s, 4–6 per beat, accumulating) |

---

## 12. Engine gaps this exposes

| Gap | Evidence | Effort | What it unlocks |
|---|---|---|---|
| **Straight-alpha compositing + linear filtering → dark fringe on every transparent PNG** | `blend.wgsl:136-139`, `context.rs:81-82`; measured 64/255 error at edge midpoint | small — premultiply in `ensure_image_texture` (`bay-preview/src/lib.rs:1287`), change 2 lines of `blend.wgsl` | Icons that do not have a black halo on light grounds. Until then the agent must flood-fill RGB |
| **No mipmaps** (`mipmap_filter: Nearest`, no chain generated) | `context.rs:83` | medium | Icons/photos scaled below 0.6× stop aliasing and crawling under motion |
| **`check.rs` is blind to images** — `Element::Video(_) \| Element::Image(_) => return Vec::new()` | `check.rs:1195` | small | A1–A8 are unimplementable until this returns findings |
| **No asset-generating tool at all** | `tools.rs` registers 40+ tools, none makes a picture | medium | §10 |
| **No SVG decode** in the `image` crate path | `bay-preview/src/lib.rs:1287` uses `image::open` | small (shell to `sips` at import) | `add_svg` without a temp-PNG dance |
| **No tint/colorize on `add_image`** | `add_image` schema has no colour parameter | small | One icon PNG serves every palette; today it is one file per colour |
| **No grain / vignette / gradient effect** | `effect_add` types = `brightness\|contrast\|saturation\|blur\|lut` | medium | Backplates as an effect rather than an import; not required — §4 covers it |
| **`animate` cannot touch an effect parameter** | round-1 finding, still true | large | An SVG asset is one static texture; a self-drawing chart still needs primitives or a PNG sequence |

---

## 13. What is honestly NOT available offline

| Want | Status | What the user would have to accept |
|---|---|---|
| Stock photography / footage | **not available** | A downloaded library (Unsplash/Pexels dumps) — an explicit user-initiated download, a licence review, and disk. Stock-footage syndrome is a named failure mode; this is not recommended |
| Hand-drawn illustration in R2's style | **not available** | Either a human illustrator, a purchased/downloaded icon-illustration set, or a generated-image model. SF Symbols + SVG covers the *function*, not the *warmth* |
| Arbitrary brand logos beyond installed apps | **not available** | A logo pack download (Simple Icons is 3,300 SVGs, MIT-licensed, ~5 MB) — small, offline-after-install, and would slot straight into `kind=svg`. **The best-value download in this table if the user wants one.** Still a download; must be user-initiated per `CLAUDE.md` |
| Photographic imagery of the subject | **partly** | The user's own `~/Pictures`. Requires explicit consent — reaching into a personal photo library unasked is exactly what the manifesto forbids |
| macOS wallpapers as photographic backplates | present (`/System/Library/Desktop Pictures/*.heic`, 24–26 MB each) | Apple's photographs are licensed for use *on the Mac*, not for redistribution in a published video. **Do not use.** Listed here so nobody rediscovers it and ships it |
| **Generated imagery** | weights present, runtime absent | `~/.cache/huggingface/hub` already holds `stabilityai/sdxl-turbo` (2.8 GB) and `sd-turbo` (2.4 GB), plus `RMBG-1.4` and `BiRefNet` (background removal) and `TripoSG` (image→3D). `diffusers`, `torch` and `mlx` are **not installed**. bay provisions its own Python, so this is buildable. **Clearly labelled option, explicitly not a recommendation:** SDXL-Turbo output is the most legible "AI made this" signal available, and the studio's position is that AI is an ingredient, not the product. If it is ever built, the defensible use is *not* illustration — it is `RMBG-1.4` cutting a user-supplied photograph out of its background, which is a tool, not a generator |
| 3D renders | not available | A renderer plus models. Skip |
| Live typing / animated UI (R1's one honest ceiling) | **available now — verified, and better than round 1 thought** | `screencapture -v -V <sec> -x -D 1 rec.mov` produced a real 3.008 s H.264 recording. Round 1 said live typing had to be faked as still-image swaps; it does not. Normalise VFR→CFR before import |
