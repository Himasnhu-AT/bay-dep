# 51 — BRIEFS B and C

Two briefs, written to the shape of `36-story-and-script.md` §7 (**Brief A**, the 9-beat
candlestick script). Brief A is not reproduced or altered here; it runs unchanged.

**How these differ from Brief A, and why.** Brief A is a *drawn* explainer — nine beats of
candles, rules and formula glyphs, **zero imported images**, 60 s, and a payoff that is an
arithmetic identity (`W = R − |r|`). Every axis on which `50-PLAN.md` is weakest is therefore
untestable against it: the asset-presence floor cannot fire on a project with no `Image`
elements (§8's own caveat); nothing in the plan rewards *cutting*, and a 60 s brief never puts
that under pressure (§9.4); and §9.2 names the premise hole — a payoff that restates its own
inputs. **Brief B** is built to load exactly those three: it *needs* imported imagery (its
subject is pictures, so a version without assets is not a worse version, it is not the video),
it runs **30 s** on a 60-word script so every line has to earn its place, and its payoff is a
substitution, not a sum. **Brief C** exists for a different reason: it is a video worth making
on its own merits, at **45 s**, and its premise is the one thing §9.2 says nothing in the plan
can check — that the piece has a reason to exist. Both use the §8 pass table; both need their
own baseline row set recorded on first run and never tuned afterwards.

**Two conventions both briefs follow.** Sizes are written as **tiers** (`hero`/`headline`/
`kicker`/`label`/`data`) and colours as **tones** (`ink`/`dim`/`accent`), never as literals —
Phase 1.2 deletes `fontSize`/`fontFamily`/`color`/`fontWeight` from the wire, and a brief that
names a number today is a brief that has to be rewritten then. Moves are written as **named
gestures with a duration and a curve**, which is registry-shaped from day one (Phase 1.3).
Every time in both beat sheets is a multiple of 0.10 s, i.e. exactly 3 frames at 30 fps, so
`off-grid` (§2.6) cannot fire on the brief itself.

**Rate.** Both scripts are budgeted at **2.50 words/sec = 150 wpm**, reached with
`speed: 0.89`. The measured machine rate is **2.99 w/s** at the default the skill recommends —
the figure the old skill documented as 2.5 is 20 % wrong and is what produced a 179 wpm read.
Both durations below are therefore computed twice: at 2.50 (what to build) and at 2.99 (what
you get if the speed is left alone), and the gap is stated, because that gap *is* the bug.

---

# AMENDMENTS — measured after these briefs were written. These override the text below.

Two later agents measured the assets and the engine against what these briefs assert. Where they
disagree with a beat sheet, **the measurement wins.** Sources: `assets/round2/MANIFEST.md` §4 and
the Phase 1.1/1.4 implementation report.

### Facts these briefs got wrong. Fix before shooting.

1. **Brief C beat 9: "5 FILES" is wrong — it is 4.** Instruction files at `HEAD` carrying a
   concrete `fontSize`/`fontFamily`/`fontWeight`/`color` value are `charts.md`, `layout.md`,
   `recipes.md`, `tools.md`. The on-screen string must read **`4 FILES`**.
2. **Brief C beat 8: the code plate cited a line that does not exist.** `fontFamily: "Menlo"`
   appears nowhere in any instruction file — the real hardcoded default is
   `"fontFamily": "Helvetica Neue"` at `references/recipes.md:18`. The plate welded a real value
   onto an unrelated citation. **For a video whose whole premise is "here are the receipts, in our
   own text", a fabricated citation is the one thing it cannot ship.** `code.png` has been
   rewritten so every line is a verbatim substring of the file and line named above it, at commit
   `396ead5`. `recipes.md:17-18` is the stronger receipt anyway: one worked example hardcoding all
   four parameters at once, which is exactly what beat 11 stacks.
3. **Brief C beat 6: "the bottom ~40% is empty" overstates it.** Measured, the last inked row of
   `w_30.0.png` is y = 1359, so **29.2%** is empty. Still a dead third. Say a third, or say 29%.
4. **Kokoro's rate is 3.30 w/s, not 2.99.** Measured through the actual code path
   (af_heart, 40 words, 3 sentences): speed 0.7 → 2.329 w/s, 0.8 → 2.623, 1.0 → 3.306, 1.2 → 3.783.
   So `speed: 1.0` is **198 wpm**, not 179. `narrate` now takes `targetWordsPerSecond` and picks
   the speed itself — **pass `targetWordsPerSecond: 2.5` and do not set `speed`.** That lands at
   147.5 wpm measured. The 2.99 figure in the header above is superseded; the *shape* of the
   argument (the documented rate was ~20% wrong and that gap is the bug) still holds.

### Asset facts that change a placement.

5. **Brief C beat 10's `√area 0.29` is structurally unreachable. Hard ceiling 0.184.**
   `fontSize` in bold mono is a 6.8:1 shape, so frame width binds its height, and the most ink one
   8-character word can hold on 1080×1920 is √area 0.184. Use `tight/strike.png` (0.178 at full
   bleed — nearly double the untrimmed plate, and still the largest anchor in the piece) **or**
   redraw the payoff as something blockier than a single monospaced word. A brief-level call;
   0.178 is acceptable.
6. **Brief B's floppy clears its floor with 7.4% to spare.** `floppy.png` is 38.94% ink; at the
   brief's 0.60 of frame width it lands √area **0.2808** against a 0.26 floor. Break-even
   placement is 0.556 — **do not shrink the floppy below 0.56 in beat 1.** Making it filled rather
   than stroked was load-bearing; at outline density it would have missed.
7. **Use `tight/oxmarks.png`, not `oxmarks.png`.** The original is 5.27% ink on its own canvas and
   trips the imported-image ink floor; the tight crop is the same artwork at 16.50% and is a
   drop-in.
8. **SF Symbol `.fill` density varies 2.6×** across the six "dead objects", so they cannot all be
   placed at one size and read as equal weight. See MANIFEST §4.5 for the per-symbol figures.
9. **`mic.fill` / `doc.fill` / `doc.text.fill` are legacy aliases, not missing.** `NSImage`
   resolves all three to real distinct glyphs. Prefer the canonical `microphone.fill` /
   `document.fill` / `text.page.fill`, but old names will not fail. **The floppy finding stands** —
   zero hits for floppy/disk/diskette across all 8,302 names, and `NSImage` rejects every spelling.

### Confirmed — do not re-litigate.

Brief C's three numeric claims hold against the pixels: the panel is **34.17%** of frame (claimed
34.2), panel:ground contrast is **1.096:1** (claimed 1.10), and the hook frame is **0.06%** ink.
The frames were opened and read: `w_18.9.png` does render an empty card with "Different day."
occluded, and `o3_25.png` genuinely reads better than its successor.

---

# Brief B — THE OX IN THE LETTER

*The generalisation check. 30 s. Imported imagery is the subject. Non-numeric payoff.*

**Subject chosen because:** it is the only class of subject that cannot be faked with shapes —
the argument is *about* pictures, so every asset is load-bearing rather than decorative, which
is precisely the condition under which an asset-presence floor means anything.

## Premise

> You stop seeing the save icon as an out-of-date picture of an object, and start seeing it as a
> letter — a sign that works *better* because the thing it once depicted is gone.

**What the viewer knows at the end that they did not know at the start:** that the icons on
their screen are mid-way through the same process that turned a drawing of an ox into the
letter A — and that the obsolescence is the mechanism, not the defect.

## Runtime: 30 seconds

The argument is **one substitution** (icon → letter). §34's intake table puts absorbable new
ideas at ~5–7 per minute; a single-idea piece has no honest claim on 60 s. The payoff is also a
single gesture — a 180° rotation — and everything after a gesture lands is decay. 30 s is not a
constraint imposed on this brief, it is the length the idea is.

## Script

Spoken by Kokoro, `af_heart`, `speed: 0.89`, one `narrate` call per line (per-phrase synthesis,
`44-expressive-tts.md` §5.3), `captions: false` — see the channel split below.

| # | line | words | s @2.50 w/s | speech act |
|---|---|---|---|---|
| 1 | You press this to save. You have never held the object. | 11 | 4.40 | stake / direct address |
| 2 | There are more. | 3 | 1.20 | accumulation |
| 3 | So draw something people recognize. | 5 | 2.00 | the obvious fix (the belief) |
| 4 | **It would stop working.** | 4 | 1.60 | **verdict** |
| 5 | A picture only competes while its object is alive. | 9 | 3.60 | causation |
| 6 | Three thousand years ago, this was an ox. | 8 | 3.20 | concrete |
| 7 | It stopped being an ox. That is when it became a letter. | 12 | 4.80 | the mechanism, restated on a case the viewer already trusts |
| 8 | Your icons are not obsolete. They are early. | 8 | 3.20 | landing |

**60 words · 24.00 s of speech · 150 wpm · 11 sentences · mean 5.5 words · longest sentence
9 · longest clip 4.80 s · speech density 80.0 % · silence 6.00 s (20.0 %) · longest silence
1.60 s.** Second person in sentence 1. Stake ("you have never held the object") in sentence 1.

**Rate arithmetic, stated because it is the trap.** The same 60 words at the **measured
2.99 w/s** deliver in **20.07 s**, not 24.00 — leaving **9.93 s of silence in a 30 s piece,
a 66.9 % speech density**, which is wicks-v2's failure signature (59.2 %) almost exactly.
Budget at **2.50** and set `speed: 0.89`. Every line clears the 8.0 s clip ceiling by 3.2 s.

**Written for a machine to read** (§5.2): the operative word is last in all eight lines —
`object`, `more`, `recognize`, `working`, `alive`, `ox`, `letter`, `early`. Eleven sentences in
sixty words means eleven authored ~0.30 s pauses; there is not one comma doing a pause's job.
No numerals are spoken — "three thousand" is written out. No object on screen is ever named
aloud.

## Beat sheet

Canvas 1080×1920 @ 30 fps. Framings are the named layouts of `32-composition.md` §2. No
authored move is shorter than **0.22 s** (≥4 core frames after easing, §1.3).

| # | span | dur | role | VO | on-screen text | picture | framing | assets |
|---|---|---|---|---|---|---|---|---|
| **1** | 0.00–5.20 | 5.20 | **hook** | L1 0.40–4.80 | *nothing until 3.10*, then `LAST MADE 2011` at **label/dim**, wipe-on L→R 0.30 s | **frame 1 is already composed** — the floppy at 0.60 of frame width, centred on x, cropped by the bottom edge. No fade-up. 0.50: it settles 3 % (0.40 s spring-out) — a weight-landing, not an entrance. 2.20–3.00: one slow 2 % push-in | **BLEED** — L / band C→D / 1 cluster / centre / *bleed* | `floppy.png` |
| **2** | 5.20–7.60 | 2.40 | setup | L2 5.20–6.40 | none | floppy shrinks to 0.22 and travels to upper-left (0.55 s expo-out). Six icons arrive on their own cues, **not on a grid**: four distinct scales (0.10–0.26), three crossing a frame edge, no labels. `animate_many`, stagger 0.16, decay 0.84 | **STACK** — S–M / spans A→D / 5 clusters / left / grounded | `phone.fill`, `envelope.fill`, `folder.fill`, `magnifyingglass`, `bookmark.fill`, `scissors` |
| **3** | 7.60–9.90 | 2.30 | belief | L3 7.60–9.60 | none | five icons exit up and out (0.35 s power4-in, stagger 0.05). Floppy travels to x 0.30 and grows to 0.34. `cloud.fill` rises in at x 0.70, same size, from below (0.50 s spring-out). A hairline gutter draws between them 0.30 s | **SPLIT-V** — M / band C / 2 / split / grounded | `cloud.fill` |
| **4** | 9.90–11.50 | 1.60 | **TURN** | L4 9.90–11.50 | **none — 0 text objects for 1.6 s** | at 9.90 exactly: the cloud **splits in two** — a duplicate separates and both slide apart 0.09 of frame (0.24 s expo-out) — then both snap to 1.45× (0.22 s) and overlap by 30 %. **Both go accent: the first appearance of the accent in the video.** Floppy dims to 45 % and does not move. Gutter hairline breaks | **OVERLAP** — L / band B–C / 2 / centre / grounded | — |
| **5** | 11.50–16.10 | 4.60 | mechanism | L5 12.00–15.60 | `WEATHER` and `STORAGE` at **label/dim**, one under each cloud, arriving 0.40 apart | a full-width rule draws at y 0.52 (0.60 s), putting the two clouds above it and the floppy alone below. Above: the labels arrive and the two clouds pull *further* apart, still overlapping. Below: the floppy returns to full ink and an **empty accent-outlined slot** draws beside it — the absence is the image, and it is the only accent below the rule | **SPLIT-H** — M–L / band B+C / 2 / centre / *horizon* | — |
| **6** | 16.10–20.90 | 4.80 | reveal | L6 16.10–19.30 | none | 16.10: everything clears upward except the floppy, which shrinks to 0.09 and parks bottom-right (it stays for the rest of the video). A single **`A` at hero/ink, √area 0.20**, lands centre-left of a thirds point (0.45 s power4-out). **19.30–20.90, voice off: the glyph rotates 180° and scales to √area 0.31 in one continuous move (1.55 s, expo-out).** This is the largest anchor in the piece | **THIRDS** — M→XL / band C→B / 2 / left / grounded | — |
| **7** | 20.90–26.30 | 5.40 | **payoff** | L7 20.90–25.70 | `ALEPH` at **label/dim**, lands 22.60 beneath the glyph | 20.90: the ox marks land — two eyes and two ears in accent, hard, 0.24 s, no fade. **`payoff` marker at 20.90.** Held to 24.20. Then the marks fall away downward (0.30 s power4-in) and the glyph rotates back to upright over 0.90 s, landing 25.10 at √area 0.24 | **FULL-TYPE** — XL / band B / 1 / centre / *bleed* | `oxmarks.png` |
| **8** | 26.30–30.00 | 3.70 | landing | L8 26.30–29.50 | `ALPHABET` at **kicker/dim**, lands 28.20, dims to 40 % by 29.40 | the six icons and the floppy return, all resized to one cap height, on **one baseline** at y 0.66 — the hook's floppy is the leftmost and is the same element that opened the video. At 28.90 **the `A` flies down into the middle of the row** at the same cap height and settles (0.40 s spring-out). Last motion completes 29.30; cut at 30.00 | **THIRDS** — S / band D / 2 / centre / grounded | all of the above |

### The turn

**Beat 4, at t = 9.90.** What flips: the fix that was just proposed is shown to have the defect
it was supposed to cure. The cloud icon splits into two live meanings and collides with itself,
while the floppy — the thing being replaced — sits still and unambiguous. The viewer arrives at
"the dead object is the *advantage*" before the voice says it in beat 5. Six axes fire at once:
scale (1.45×), position (split), colour (first accent), count (1→2), text (all text absent),
and the incumbent's state (floppy dims and freezes).

### Narration / caption / on-screen split

**There is no caption band.** `narrate(captions: false)` on all eight calls. The frame carries
imagery the viewer must look at for the entire runtime, which is §34's redundancy-penalty
regime (Mayer, median *d* ≈ 0.7); wicks-v2 spent ~9.5 s of a 61 s runtime moving the eye
between two copies of the same sentence. The hook is §34 pattern 2 (contradiction of a held
belief), which is on the list that works muted.

| beat | voice carries | picture carries | on-screen text carries |
|---|---|---|---|
| 1 | that you have never touched it | *which object it is* | the date it died (`LAST MADE 2011`) — a fact the voice never states |
| 2 | that there are more | *which* ones, and how many | — |
| 3 | the proposal | what the proposal looks like (the cloud, same size, same slot) | — |
| 4 | the verdict, four words | the whole mechanism of the verdict | — |
| 5 | the causal rule | the two live meanings vs the one dead one | the two meanings, named |
| 6 | the age and the referent | the glyph, and the rotation | — |
| 7 | why the death is the promotion | the ox | the name of the sign (`ALEPH`) |
| 8 | the thesis | that they are all the same kind of mark | what that kind is (`ALPHABET`) |

Five on-screen strings, ~8 words, peak **2** simultaneous text objects. wicks-v2: 100 tokens,
peak 16.

### Audio

One bed element, volume-keyframed (`duck`, §2.8) — never sliced. Depth **12–14 dB** under
speech, recovering to **6–8 dB** in gaps, attack ~250 ms, release ~600 ms. One-shots: a dry
click on each icon arrival in beat 2 (six, at descending pitch), a low break at 9.90, one
impact at **20.90** on the ox marks. `payoff` marker committed at **20.90 before any audio
element exists** — the loudest 400 ms window must land there. **No "on the beat" instruction is
given**, and none may be added: bay's current bed is a 62 s drone whose best-fit grid explains
28 % of onsets against a 20 % chance rate (§9.5), so every such instruction is unfalsifiable.

### Assets required — every command run on this machine

```bash
# 0. the SF Symbols rasteriser — 39-assets.md §3, plus the --flood fix for the dark-edge
#    fringing that straight-alpha bilinear filtering produces on every transparent PNG.
#    Write sfsym.swift (see below), then:
swiftc -O sfsym.swift -o sfsym                       # 1.72 s, once

# 1. six dead objects + the modern replacement            0.47 s each, measured
./sfsym phone.fill        512 "#EDECE6" phone.png    --flood
./sfsym envelope.fill     512 "#EDECE6" envelope.png --flood
./sfsym folder.fill       512 "#EDECE6" folder.png   --flood
./sfsym magnifyingglass   512 "#EDECE6" mag.png      --flood
./sfsym bookmark.fill     512 "#EDECE6" bookmark.png --flood
./sfsym scissors          512 "#EDECE6" scissors.png --flood
./sfsym cloud.fill        512 "#EDECE6" cloud.png    --flood
# a bad name exits 3 with "no such symbol: <name>" — a real error, not a blank asset

# 2. the floppy — SF Symbols has NO floppy disk (searched all 8302 names for
#    floppy/disk/diskette: zero hits), so it is an authored vector.       0.02 s
sips -s format png floppy.svg --out floppy.png       # → 720x720, hasAlpha: yes

# 3. the ox marks — two eyes, two ears, accent                            0.02 s
sips -s format png oxmarks.svg --out oxmarks.png     # → 600x400, hasAlpha: yes

# 4. OPTIONAL ground. Not mandated: 50-PLAN §7 forbids requiring a non-flat background,
#    and both reference videos have grounds flatter than ours.            0.35 s
ffmpeg -y -f lavfi -i "gradients=s=1080x1920:c0=0x14141C:c1=0x0A0A0E:x0=0:y0=0:x1=200:y1=1920:type=linear" \
  -vf "noise=alls=9:allf=t+u,vignette=PI/4.2,format=rgb24" -frames:v 1 bp_grain.png
```

`floppy.svg` — **filled, not stroked**, deliberately: `anchorScale` is measured on the rendered
ink cluster, and a hollow outline has a fraction of its bounding box's area. A stroked floppy
would miss the √area ≥ 0.26 floor while looking identical in a contact sheet.

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 64 64">
  <path d="M7 7 h42 l8 8 v42 a2 2 0 0 1 -2 2 H9 a2 2 0 0 1 -2 -2 V9 a2 2 0 0 1 2 -2 z
           M19 7 v17 a1 1 0 0 0 1 1 h24 a1 1 0 0 0 1 -1 V7 z
           M15 38 v19 h34 V38 a1 1 0 0 0 -1 -1 H16 a1 1 0 0 0 -1 1 z"
        fill="#EDECE6" fill-rule="evenodd"/>
  <rect x="35" y="10" width="6"  height="12"  rx="1"   fill="#EDECE6"/>
  <rect x="20" y="42" width="24" height="2.6" rx="1.3" fill="#EDECE6"/>
  <rect x="20" y="48" width="17" height="2.6" rx="1.3" fill="#EDECE6"/>
</svg>
```

```xml
<!-- oxmarks.svg -->
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 60 40">
  <circle cx="22" cy="18" r="3.2" fill="#FF5B5B"/>
  <circle cx="38" cy="18" r="3.2" fill="#FF5B5B"/>
  <path d="M14 22 q-6 2 -6 8 q5 -1 7 -5 z" fill="#FF5B5B"/>
  <path d="M46 22 q6 2 6 8 q-5 -1 -7 -5 z" fill="#FF5B5B"/>
</svg>
```

`sfsym.swift` is `39-assets.md` §3 verbatim with two changes, both verified: a `--flood`
argument that writes the fill colour into the RGB of every transparent pixel (keeping alpha),
which takes the edge error from 64/255 to 0; and a real `stderr` message + exit 3 on an unknown
symbol name.

```swift
import AppKit
// sfsym NAME SIZE #HEX OUT.png [--flood]
let a = CommandLine.arguments
let name = a[1], size = CGFloat(Double(a[2])!), out = a[4]
func color(_ h: String) -> NSColor { var s=h; if s.hasPrefix("#"){s.removeFirst()}
  var v: UInt64 = 0; Scanner(string:s).scanHexInt64(&v)
  return NSColor(srgbRed: CGFloat((v>>16)&255)/255, green: CGFloat((v>>8)&255)/255,
                 blue: CGFloat(v&255)/255, alpha: 1) }
guard let img = NSImage(systemSymbolName: name, accessibilityDescription: nil) else {
  FileHandle.standardError.write("no such symbol: \(name)\n".data(using:.utf8)!); exit(3) }
let fill = color(a[3])
let cfg = NSImage.SymbolConfiguration(pointSize: size, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [fill]))
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
if CommandLine.arguments.count > 5 && CommandLine.arguments[5] == "--flood" {
  let r = UInt8(fill.redComponent*255), g = UInt8(fill.greenComponent*255), b = UInt8(fill.blueComponent*255)
  let px = rep.bitmapData!
  for i in stride(from: 0, to: w*h*4, by: 4) { px[i]=r; px[i+1]=g; px[i+2]=b }
}
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
```

**Render the symbols at 1.0–1.4× their on-screen pixel size, never 3×.** bay has
`MipmapFilterMode::Nearest` and no mip chain; a 700 px icon shown at 200 px aliases under
motion.

**Asset count: 9 imported images**, 8 of them present in ≥2 beats. The asset-presence floor
(≥1 `Image`/`Video` above 15 s) is not merely satisfied here, it is load-bearing — remove the
assets and there is no video.

### What would make this video bad

1. **The icon parade becomes a listicle.** If beat 2's six icons arrive on an even grid at one
   scale with one stagger and each gets a label, this turns into "six outdated icons you never
   noticed" — the exact genre the piece argues against, and a list has no turn, so the whole
   second half is left with nothing to overturn. Guard: four distinct scales, no grid, no
   labels, three icons crossing a frame edge.
2. **The ox lands as trivia.** If beat 5 (the causal rule) is cut or rushed for time, the
   rotation becomes a did-you-know and the payoff is §9.2's failure in a new costume — correct,
   well-staged, worth nothing. The ox only works as a *confirmation* of a rule the viewer has
   already accepted. If the piece runs long, cut beats 6–7 and ship a 22 s version; do not cut
   beat 5.
3. **The voice names the pictures.** The moment the narration says "floppy disk", "cloud" or
   "the letter A", the picture becomes a caption for the audio and the redundancy penalty
   applies for the full runtime. The script names no on-screen object; the temptation to
   "clarify" is the failure mode, and clarity is what the pictures are for.

---

# Brief C — WE ADDED FOUR MEASUREMENTS AND IT GOT WORSE

*A video worth making on its own merits. 45 s. Real frames, real numbers, ours.*

## Premise

> A measurement you can satisfy without doing the work becomes the cheapest way to score — so
> adding measurements to a system that is already failing makes it fail more confidently.

**What the viewer knows at the end that they did not know at the start:** that the agent which
hit all four of our new metrics and produced a worse video was not gaming us — it was obeying
us, and the fix is not a fifth measurement but a deleted parameter. **Why it matters:** the
standard response to a bad AI output right now is to add an eval. This is a worked case, with
the receipts, of that move making the output worse — and of the diagnosis being in the
instructions, not the model.

**Survives the §9.2 test:** the payoff is not an identity that restates its inputs. Nothing in
the first 35 seconds implies it. The evidence points at the agent for the whole setup and then
resolves onto the author, which is a conclusion the viewer cannot have pre-computed from the
premises they were given.

## Runtime: 45 seconds

Four movements — it looked fine / here is what it was / we measured it and it got worse / we
wrote the defaults it copied. That is more than 30 s of argument and less than 60 s of
material. It is also **not 60 s on purpose**: the failure this video is about is partly a
length failure (§9.4 — a 25 s cut of wicks-v2 would have failed almost nothing and been
better), and a 60-second video about that would refute itself.

## Script

`af_heart`, `speed: 0.89`, one `narrate` call per line, `captions: false`.

| # | line | words | s @2.50 w/s | speech act |
|---|---|---|---|---|
| 1 | We wrote the checks. This passed all of them. | 9 | 3.60 | stake |
| 2 | The largest object in every frame is invisible. | 8 | 3.20 | evidence |
| 3 | So we added measurements. Four of them. | 7 | 2.80 | the fix we tried |
| 4 | The next version hit all four. | 6 | 2.40 | prediction satisfied |
| 5 | **It was worse.** | 3 | 1.20 | **verdict** |
| 6 | Each measurement counted distinct values. A single exception anywhere satisfies a count. | 12 | 4.80 | mechanism |
| 7 | So it sprinkled one of each. | 6 | 2.40 | consequence |
| 8 | Then we read the instructions it was following. | 8 | 3.20 | pivot |
| 9 | It invented nothing. Every default it chose came from us. | 10 | 4.00 | **the real verdict** |
| 10 | You cannot game a number you are not allowed to type. | 11 | 4.40 | the rule |
| 11 | The fix was not another check. It was one less choice. | 11 | 4.40 | landing |

**91 words · 36.40 s of speech · 150 wpm · 16 sentences · mean 5.7 words · longest sentence 11
· longest clip 4.80 s · speech density 80.9 % · silence 8.60 s (19.1 %) · longest silence
1.80 s.** Second person in line 10, which is late by Brief A's standard and deliberate: for
ten lines this is a first-person account of our own artefact, and "you" arrives exactly when
the claim stops being about us.

**Rate arithmetic.** The same 91 words at the measured **2.99 w/s** deliver in **30.43 s**, not
36.40 — 5.97 s short, leaving a 45 s piece at 67.6 % density. Budget at 2.50, `speed: 0.89`.

**Not one figure is spoken.** `34.2 %`, `1.10:1`, `19`, `47`, `188`, `−13.9`, `8 of 9`,
`242` and `5` all appear on screen and nowhere in the audio. That is the §34 dual-coding split
applied strictly, and it is also what keeps every clip under 8.0 s — the one line that would
have blown the ceiling is the one that reads a table aloud.

**Operative word last** in nine of eleven lines: `invisible`, `worse`, `count`, `each`,
`following`, `us`, `type`, `choice`, and `four` (L4). L1 and L3 both end on `them`, which is
weak — they are the two lines whose work the *picture* does, and they are deliberately the two
flattest reads in the piece.

## Beat sheet

Canvas 1080×1920 @ 30 fps — the same canvas as the video being examined, so every extracted
frame drops in at native size with no resample. No authored move under **0.22 s**.

| # | span | dur | role | VO | on-screen text | picture | framing | assets |
|---|---|---|---|---|---|---|---|---|
| **1** | 0.00–4.60 | 4.60 | **hook** | L1 0.40–4.00 | `0 ERRORS · 242 WARNINGS` at **label/dim**, lands 2.40 | **frame 1 is a real frame of the failed video, full-bleed, already composed.** No fade. 0.30: it settles 2 % (0.35 s spring-out). It is shown at 100 % and unannotated — the viewer is allowed to think it looks fine, because it does | **FIELD** — XL / n/a / 1 / any / *bleed* | `w_30.0.png` |
| **2** | 4.60–8.70 | 4.10 | evidence | L2 4.60–7.80 | `34.2% OF FRAME` at **data/ink** and `1.10 : 1` at **data/accent**, the ratio counting 0.00→1.10 over 0.80 s, landing 7.20 | the frame dims to 30 %. An **accent outline draws around the panel** — the actual rectangle, at its actual bounds — over 0.70 s, and the enclosed region alone returns to 100 %. The number sits inside it. **The first appearance of the accent** | **INSET** — L / band B / 2 / centre / grounded | same plate |
| **3** | 8.70–11.80 | 3.10 | the fix we tried | L3 8.70–11.50 | four names at **label/dim**, arriving 0.30 apart: `DISTINCT EASINGS`, `DISTINCT DURATIONS`, `ELEMENT COUNT`, `LOUDNESS` | the plate shrinks to 0.14 and parks top-right, still lit (it stays until beat 6). Four rows arrive left, `animate_many`, stagger 0.30, decay 1.0 — even, because they were written as a set | **STACK** — S / spans B→C / 2 / left / grounded | — |
| **4** | 11.80–14.80 | 3.00 | the score | L4 11.80–14.20 | `19`, `47`, `188`, `−13.9` at **data/ink**, one per row | a tick draws beside each row in sequence (0.26 s each, stagger 0.28) and the row's value lands with it. All four go **ink, not accent** — they are passes, and a pass is not a signal | **STACK** — S / spans B→C / 3 / left / grounded | — |
| **5** | 14.80–16.40 | 1.60 | **TURN** | L5 14.80–16.00 | **none — 0 text objects for 1.6 s** | at 14.80 exactly: the four rows and their ticks **eject upward out of frame** (0.30 s power4-in, stagger 0.04). The corner plate scales 1.0→2.4× and travels to fill the left half (0.40 s expo-out). A second real frame — from the video this one *replaced* — snaps into the right half at the same size, hard, no fade. Centroid drops y 0.38 → 0.52 | **SPLIT-V** — L / band C / 2 / split / grounded | `w_18.9.png`, `o3_25.png` |
| **6** | 16.40–23.20 | 6.80 | aftermath | L6 17.80–22.60 | `8 OF 9 AXES WORSE` at **headline/accent**, lands 18.60 on the seam between the two frames | 16.40–17.80 the two frames hold, silent. 18.60: the verdict lands on the gutter. 19.40–22.60: **nine hairline rules draw across both halves in sequence**, one per axis; eight of them light accent on the left half and ink on the right; the ninth does the reverse. The one axis we won is visibly the only one | **SPLIT-V** — L / band C / 3 / split / *horizon* | same two frames |
| **7** | 23.20–26.30 | 3.10 | sprinkle | L7 23.20–25.60 | `19 EASINGS · 121 DO NOTHING` at **label/dim**, lands 24.20 | the two frames exit left and right (0.40 s power4-in). **19 vertical bars grow from a shared baseline** (0.55 s expo-out, stagger 0.03): one full height, eighteen at ~6 %. The tall one is accent. This is the count being satisfied, drawn to scale | **DIAG** — M / band C / 1 / centre / grounded | — |
| **8** | 26.30–29.90 | 3.60 | the source | L8 26.30–29.50 | *(the plate is text-as-image; no text elements)* | the eighteen slivers fade to 15 %; **the single accent bar rotates 90° and travels** (0.85 s power4-out) into a code plate that assembles under it — real lines from our own reference files, set in the same monospace the video shipped in. The bar lands as the highlight rule on one line | **INSET** — M–L / band B–C / 2 / centre / grounded | `code.png` |
| **9** | 29.90–35.10 | 5.20 | **the real verdict** | L9 29.90–33.90 | `5 FILES` at **label/accent**, lands 32.40 | the plate scrolls 0.30 of its height (1.20 s, linear — it is a document, not a gesture) revealing three more matches. Each match strikes accent as it passes the highlight rule. At 33.20 the plate holds and the four highlighted fragments **detach and stack** at centre, isolated from their file | **INSET** — M / band B / 3 / centre / grounded | same plate |
| **10** | 35.10–40.20 | 5.10 | **payoff** | L10 35.10–39.50 | *(the parameter is inside the plate)* | 35.10: everything clears except one fragment, which scales to **hero** and re-sets as a bare parameter name — `fontSize` — at √area 0.29, the largest anchor in the piece. It sits alone from 35.60. **39.30–39.60: an accent rule strikes through it, hard, landing on the last spoken word.** `payoff` marker at **39.50** | **FULL-TYPE** — XL / band B / 1 / centre / grounded | `strike.png` |
| **11** | 40.20–45.00 | 4.80 | landing | L11 40.20–44.60 | — | the struck parameter shrinks to 0.55 and rises to band B. **43.60: three more struck parameters land beneath it** — `color`, `fontWeight`, `fontFamily` — stagger 0.20, each already struck. The stack of four is the last image and the newest information in the video. Last motion completes 44.30; cut at 45.00 | **LOCKUP** — M / band B–C / 1 / centre / float | `strike.png` ×4 |

### The turn

**Two of them, and that is the structure.** Beat 5 at t = 14.80 is the *apparent* turn — the
four passes eject and the comparison lands, and the viewer concludes the agent gamed us. Beat 9
at t = 29.90 is the **real** turn: the defaults it "chose" are printed in our own files, five
times. What flips is the subject of the sentence. Everything before beat 8 is evidence against
the agent; everything after is evidence against the author, using the identical evidence. The
piece is only worth 45 seconds because of the second one.

### Narration / caption / on-screen split

No caption band. `captions: false`. Every frame from beat 1 onward carries something that must
be read — a real screenshot, a bar field, a code plate — so a verbatim caption is the §34
penalty regime for the entire runtime. The hook is §34 pattern 8 (stake/consequence), which
works muted.

| beat | voice carries | picture carries | on-screen text carries |
|---|---|---|---|
| 1 | that we wrote the checks it passed | what it looked like | the check result (`0 ERRORS · 242 WARNINGS`) |
| 2 | the word *invisible* | *which* object, at its real bounds | the size and the contrast ratio |
| 3 | that there were four | that they arrived as a set | their names |
| 4 | that all four passed | the passing | the four values |
| 5 | the verdict, three words | the comparison | — |
| 6 | why a count is satisfiable | the nine axes, eight lost | the score |
| 7 | the word *sprinkled* | the shape of a sprinkle, to scale | the count and how many are inert |
| 8 | that we went and read them | the actual file | — |
| 9 | that it invented nothing | the matches, in our own text | how many files |
| 10 | the rule | which parameter, and the strike | — |
| 11 | the thesis | that it generalises to four parameters | — |

Nine on-screen strings, peak **4** simultaneous text objects (beat 4 — a genuine list, and the
only beat that is one).

### Audio

One bed, volume-keyframed, same duck shape as Brief B. One-shots: a soft tick per row arrival
in beats 3–4, a low break at 14.80, nine short ticks on the axis rules in beat 6 (descending),
and **one dry impact at 39.50** on the strike. `payoff` marker committed at **39.50 before any
audio element exists**. Beat 6's 1.40 s of held silence at 16.40–17.80 is the quietest point in
the mix and is not filled.

### Assets required — every command run on this machine

```bash
# 1. real frames from the failed video and its predecessor    ~0.10 s each, 1080x1920
ffmpeg -y -ss 30.0 -i ~/Desktop/wicks-v2.mp4               -frames:v 1 w_30.0.png
ffmpeg -y -ss 18.9 -i ~/Desktop/wicks-v2.mp4               -frames:v 1 w_18.9.png
ffmpeg -y -ss  0.5 -i ~/Desktop/wicks-v2.mp4               -frames:v 1 w_0.5.png    # spare: the blank hook
ffmpeg -y -ss 25.0 -i ~/Desktop/candlestick-wicks.mp4      -frames:v 1 o3_25.png

# 2. the code plate and the struck parameter — sips renders SVG <text> in Menlo    0.02 s each
sips -s format png code.svg   --out code.png     # → 900x260, hasAlpha: yes
sips -s format png strike.svg --out strike.png   # → 900x200, hasAlpha: yes
```

```xml
<!-- code.svg — the real lines, set in the face the video shipped in -->
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 90 26">
  <text x="4" y="8"  font-family="Menlo" font-size="5" fill="#8A8A96">references/layout.md:27</text>
  <text x="4" y="17" font-family="Menlo" font-size="6" fill="#EDECE6">x: 0.089,  scale: 0.744</text>
  <text x="4" y="24" font-family="Menlo" font-size="6" fill="#FF5B5B">fontFamily: "Menlo"</text>
</svg>
```

```xml
<!-- strike.svg — one per parameter; change the label and the line's x2 -->
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200" viewBox="0 0 90 20">
  <text x="4" y="13" font-family="Menlo" font-weight="bold" font-size="9" fill="#EDECE6">fontSize</text>
  <line x1="2" y1="10" x2="44" y2="10" stroke="#FF5B5B" stroke-width="1.6" stroke-linecap="round"/>
</svg>
```

**The extracted frames were opened and read, not just written.** `w_0.5.png` is black except a
tick strip in the top-left — the 0.08 % hook. `w_30.0.png` shows the panel as a rectangle
barely separable from the ground, with the bottom ~40 % of the frame empty. `w_18.9.png` shows
the card rendering **empty** — gridlines and nothing else — and the headline reading only
"Same range." with "Different day." absent. All three claims in this brief's beats 1–2 and 5
are visible in the assets themselves; none is taken from a table.

**Asset count: 6 imported images** (4 real frames, 2 rendered plates), plus 3 more `strike.png`
variants for beat 11. No network, no screen-recording permission, no font install.

### What would make this video bad

1. **It becomes a product pitch.** The instant the piece names bay, shows the editor UI, or
   ends on "so we fixed it and now it's great", the finding stops being a finding and becomes a
   changelog, and a changelog has no reason to exist outside the company that shipped it.
   Nothing in the video may identify the product. The subject is the mechanism; the receipts
   merely happen to be ours.
2. **Self-flagellation as content.** "We were wrong, here is our humility" is a genre and it is
   worth nothing. The piece earns its 45 seconds only if line 10 lands as a general claim about
   measurement. If the landing is about *us* rather than about the rule, the video is an apology
   and should not be made.
3. **Reading the numbers aloud.** Every figure is on screen and none is spoken, by design. If
   the narration says "thirty four point two percent of the frame at one point one to one", the
   video becomes a table being read to you, the eye has nothing to do, and that single line runs
   past the 8.0 s clip ceiling — one edit breaking the dual-coding split, the pacing, and the
   synthesis constraint at the same time.

---

# What I could not verify

Stated so nobody has to discover it at render time.

1. **Neither brief has been run through bay.** No `project_create`, no `narrate`, no `render`.
   Every duration below is *predicted* from the corpus's measured 2.50 w/s target, not from a
   synthesis performed here. **First run must record the actual `wordsPerSecond` returned and
   re-time both sheets once**, then never again. Headroom is large: the longest clip in either
   brief is 4.80 s against an 8.0 s ceiling, so the estimate can be 60 % wrong before a clip is
   rejected.
2. **No `anchorScale` figure in either sheet was measured.** The √area targets (0.31 for Brief
   B's ox, 0.29 for Brief C's parameter) are computed from intended bounding boxes, but √area is
   measured on the *rendered ink cluster*. I made the floppy a filled glyph for exactly this
   reason, but I did not measure the ink density of a single SF Symbol `.fill` variant, and they
   differ. If beat 1 of Brief B misses the 0.26 floor, the fix is to grow the floppy, not to
   change the check.
3. **`sips` SVG support is verified on macOS 26.5.2 only.** The minimum macOS version is
   unverified — `39-assets.md` §5 flags the same gap. If it becomes load-bearing, pin it.
4. **The bed is unspecified beyond a role in both briefs.** bay's current `bed.wav` is a 62 s
   drone (RMS varies 2 dB, best-fit grid explains 28 % of 162 onsets against a 20 % chance
   rate), so no brief may say "land on the beat" and neither does. What a bed *should* be here
   is out of scope until `music_bed` returns a grid.
5. **`captions: false` is confirmed available** on `narrate` (`tools.rs`), but neither brief has
   been tested for legibility muted without a caption band. Both hooks are on §34's
   works-muted list; that is an argument, not a measurement.
6. **Corrections to `39-assets.md` found while verifying it.** SF Symbols contains **no floppy
   disk** — searching all 8302 names for `floppy`/`disk`/`diskette` returns zero — which is why
   Brief B authors one. Three names used loosely in the corpus do not exist: `mic.fill`,
   `doc.fill` and `doc.text.fill` are `microphone.fill`, `document.fill` and `text.page.fill`.
   Everything else in §3–§6 of that file reproduced exactly, including the measured timings.
