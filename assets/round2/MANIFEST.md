# Round 2 assets — manifest

Every asset for **Brief B ("The Ox in the Letter", 30 s)** and **Brief C ("We added four
measurements and it got worse", 45 s)**, from `prompt-res/round2/51-BRIEFS.md`.

Built on this machine, offline, no network call: macOS 26.5.2 (build 25F84), Apple silicon,
`swiftc` 6.3.3, `ffmpeg` 8.1.2, `/usr/bin/sips`, Python 3 + Pillow 12.3.0.

All paths below are relative to `/Users/himanshu/codes/synthai/vii/assets/round2/`.

**Ink coverage** is measured with `tools/inkmeasure.py`, not assumed. For a transparent asset it
is the fraction of the *whole canvas* whose alpha > 0.5 and whose luminance is ≥ 0.10 off the
ground; for an opaque frame grab the ground is the modal luminance, so ink is what stands off
the backdrop. `bbox fill` is ink ÷ ink-bounding-box, which is the density figure Brief B's
`√area ≥ 0.26` floor actually turns on.

---

## 1. Brief B — The Ox in the Letter

| file | px | alpha | ink (canvas) | bbox fill | beat(s) | produced by |
|---|---|---|---|---|---|---|
| `floppy.png` | 720×720 | yes | **38.94 %** | 61.4 % | 1 (hero), 2, 3, 4, 5, 6, 8 | `sips -s format png svg/floppy.svg --out floppy.png` |
| `phone.png` | 596×570 | yes | 24.28 % | 35.7 % | 2, 8 | `tools/sfsym phone.fill 512 "#EDECE6" phone.png --flood` |
| `envelope.png` | 747×534 | yes | 52.41 % | 76.2 % | 2, 8 | `tools/sfsym envelope.fill 512 "#EDECE6" envelope.png --flood` |
| `folder.png` | 705×561 | yes | 58.06 % | 84.5 % | 2, 8 | `tools/sfsym folder.fill 512 "#EDECE6" folder.png --flood` |
| `mag.png` | 613×591 | yes | 22.48 % | 32.6 % | 2, 8 | `tools/sfsym magnifyingglass 512 "#EDECE6" mag.png --flood` |
| `bookmark.png` | 543×646 | yes | 51.13 % | 90.8 % | 2, 8 | `tools/sfsym bookmark.fill 512 "#EDECE6" bookmark.png --flood` |
| `scissors.png` | 785×607 | yes | 25.51 % | 37.4 % | 2, 8 | `tools/sfsym scissors 512 "#EDECE6" scissors.png --flood` |
| `cloud.png` | 692×499 | yes | 55.17 % | 75.7 % | 3, 4, 5 | `tools/sfsym cloud.fill 512 "#EDECE6" cloud.png --flood` |
| `oxmarks.png` | 600×400 | yes | **5.27 %** | 18.9 % | 7 | `sips -s format png svg/oxmarks.svg --out oxmarks.png` |
| `tight/oxmarks.png` | 456×168 | yes | 16.50 % | 18.9 % | 7 (drop-in, see §4.3) | `python3 tools/tightcrop.py oxmarks.png tight/oxmarks.png 8` |
| `at256/*.png` (6) | 272–393 wide | yes | as above | as above | 2, 8 (see §4.5) | `tools/sfsym <name> 256 "#EDECE6" at256/<n>.png --flood` |
| `bp_grain.png` | 1080×1920 | no | n/a (ground) | n/a | optional ground | `ffmpeg` recipe, §5 below |

Nine imported images as the brief requires, eight of them present in ≥ 2 beats.

## 2. Brief C — We added four measurements and it got worse

| file | px | alpha | ink (canvas) | bbox fill | beat(s) | produced by |
|---|---|---|---|---|---|---|
| `w_30.0.png` | 1080×1920 | no | 7.25 % | 14.6 % | 1 (full-bleed), 2, 3, 5, 6 | `ffmpeg -y -ss 30.0 -i ~/Desktop/wicks-v2.mp4 -frames:v 1 w_30.0.png` |
| `w_18.9.png` | 1080×1920 | no | 1.93 % | 4.4 % | 5, 6 (left half) | `ffmpeg -y -ss 18.9 -i ~/Desktop/wicks-v2.mp4 -frames:v 1 w_18.9.png` |
| `w_0.5.png` | 1080×1920 | no | 0.06 % | 12.9 % | spare (the blank hook) | `ffmpeg -y -ss 0.5 -i ~/Desktop/wicks-v2.mp4 -frames:v 1 w_0.5.png` |
| `o3_25.png` | 1080×1920 | no | 2.46 % | 5.9 % | 5, 6 (right half) | `ffmpeg -y -ss 25.0 -i ~/Desktop/candlestick-wicks.mp4 -frames:v 1 o3_25.png` |
| `code.png` | 900×260 | yes | 9.11 % | 14.3 % | 8 | `python3 tools/mkplates.py` → `sips` on `svg/code.svg` |
| `code_scroll.png` | 900×620 | yes | 11.30 % | 14.2 % | 9 (see §4.4) | `python3 tools/mkplates.py` → `sips` on `svg/code_scroll.svg` |
| `strike.png` | 900×200 | yes | 7.58 % | 41.0 % | 10, 11 | `python3 tools/mkplates.py` → `sips` on `svg/strike_fontSize.svg` |
| `strike_color.png` | 900×200 | yes | 4.66 % | 38.1 % | 11 | ditto, label `color` |
| `strike_fontWeight.png` | 900×200 | yes | 9.81 % | 34.6 % | 11 | ditto, label `fontWeight` |
| `strike_fontFamily.png` | 900×200 | yes | 9.49 % | 33.2 % | 11 | ditto, label `fontFamily` |
| `tight/strike*.png` (4) | 330–601 wide | yes | 27.1–31.9 % | as above | 10, 11 (drop-in, §4.2) | `python3 tools/tightcrop.py <f>.png tight/<f>.png 8` |

Six imported images plus three extra `strike` variants, as the brief specifies.

## 3. Tools

| file | what |
|---|---|
| `tools/sfsym.swift`, `tools/sfsym` | SF Symbols rasteriser. `swiftc -O sfsym.swift -o sfsym`, 1.35 s |
| `tools/inkmeasure.py` | dimensions, alpha, ink coverage, ink bbox, `√area` anchor at a placement |
| `tools/mkplates.py` | Brief C's code and strike plates; measures each label's ink to set the strike width |
| `tools/tightcrop.py` | crops a transparent PNG to its ink bbox — recovers anchor thrown away on empty canvas |

`sfsym` verification, as required: `./sfsym floppy.disk.fill 512 "#EDECE6" out.png` prints
`no such symbol: floppy.disk.fill` to stderr and **exits 3**, writing no file. Missing arguments
exit 2. A real error, never a blank PNG.

## 4. Where measurement disagreed with the brief

### 4.1 `--flood` as the brief writes it is a no-op — fixed

The brief's `sfsym.swift` floods `rep.bitmapData` in place. Measured, that changes nothing:
`NSGraphicsContext` draws into a **premultiplied** bitmap, and `representation(using: .png)`
un-premultiplies on the way out, recomputing RGB = 0 for every pixel whose alpha is 0 no matter
what was written there. Transparent RGB stayed `(0,0,0)`; edge error stayed **59.2/255**. The
literal all-pixel reading (`--flood-all`) is worse — it divides partially-covered pixels by their
own alpha and pushes the anti-aliased edge from `(238,237,232)` to `(254,254,254)`.

Fix, now in `tools/sfsym.swift`: copy into a second `NSBitmapImageRep` declared
`.alphaNonpremultiplied`, un-premultiply by hand, and flood there. A straight-alpha rep needs no
conversion at encode time, so the RGB under alpha 0 survives into the file.

| | transparent RGB | edge midpoint over `#0E0E12` | error |
|---|---|---|---|
| no flood | (0, 0, 0) | 66.2, 66.0, 66.5 | **59.2/255** |
| `--flood`, as fixed | (237, 236, 230) | 125.5, 125.0, 124.0 | **0.0/255** |

The brief's claimed outcome is right; only its mechanism was wrong.

### 4.2 Brief C beat 10's `√area 0.29` is unreachable — hard ceiling 0.184

`strike.png` is 900×200 holding a 476×70 word: **89 % of the canvas you place is nothing**, so
at full frame width it scores an anchor of only **0.0974**. Reaching 0.29 would need the element
placed at **2.98× the frame width**.

Tight-cropping to the ink (`tight/strike.png`, 492×87) nearly doubles it to **0.178** at full
bleed — use that file for beats 10–11. But the ceiling is structural, not fixable by cropping:
`fontSize` in bold mono is a **6.8 : 1** shape, so frame width binds its height to 159 px, and the
most ink a single 8-character word can hold on a 1080×1920 frame is **√area 0.184**.

**0.29 is not achievable for this payoff image.** Either the beat accepts ~0.18 (still the
largest anchor in the piece — nothing else comes close), or the payoff is re-drawn as something
blockier than one monospaced word. This is a brief-level decision, not an asset one.

### 4.3 `oxmarks.png` is hollow enough to trip the A3 check

5.27 % ink on its own canvas. `39-assets.md` rule **A3** errors on an imported image whose ink is
< 8 %. Read against the bounding box it passes (18.9 %); read against the canvas it **fails**.
`tight/oxmarks.png` (456×168, 16.50 %) clears the floor on either reading and is a drop-in —
same artwork, less empty canvas. The brief's file is kept unchanged alongside it.

### 4.4 Brief C beat 9 cannot scroll a three-line plate

Beat 9 scrolls the code plate "0.30 of its height … revealing three more matches". The specified
`code.png` is 900×260 with three lines; scrolling it 30 % reveals nothing. `code_scroll.png`
(900×620, nine lines, seven real matches across all four instruction files) is what beat 9 needs.
`code.png` is still correct for beat 8, where the plate merely assembles.

### 4.5 SF Symbol `.fill` density varies 2.6× — and the brief's own size rule is violated

The brief flagged that it never measured `.fill` ink density. Measured, the spread is **22.48 %
(`magnifyingglass`) to 58.06 % (`folder`)** — a 2.6× range. Any beat that assumes icons of equal
scale read as equal weight is wrong: at one scale, `folder` carries 2.6× the ink of
`magnifyingglass`. Beat 2's "four distinct scales" should account for this, or `folder`,
`envelope`, `bookmark` and `cloud` will dominate.

Separately, the brief's asset commands say `512` while the brief's own rule says render at
**1.0–1.4× on-screen size, never 3×** (bay has `MipmapFilterMode::Nearest` and no mip chain).
Beat 2 places these icons at 0.10–0.26 of frame width — 108–281 px — so the 512 set is minified
**1.9–2.8×** at the *largest* placement and up to 7.3× at the smallest. `at256/` is the same six
icons at pointSize 256, which lands 0.97–1.40× at the 0.26 placement:

| icon | src @512 | src @256 | ratio @0.26 (281 px) |
|---|---|---|---|
| phone | 596 | 298 | 2.12× → **1.06×** |
| envelope | 747 | 374 | 2.66× → **1.33×** |
| folder | 705 | 353 | 2.51× → **1.26×** |
| mag | 613 | 306 | 2.18× → **1.09×** |
| bookmark | 543 | 272 | 1.93× → **0.97×** |
| scissors | 785 | 393 | 2.80× → **1.40×** |

`cloud.png` (1.30× at beat 4's peak) and `floppy.png` (1.11× at beat 1) are already correct at
their specified sizes — leave those alone.

### 4.6 Brief C's code plate cited a line that does not exist — rewritten from real text

The brief's `code.svg` renders `references/layout.md:27` above `fontFamily: "Menlo"`. Checked:

- `references/layout.md:27` is `- **Left gutter 96px** → \`x: 0.089\`` — real, and `scale: 0.744`
  is on line 28. Both correct.
- **`fontFamily: "Menlo"` is not in that file, or in any instruction file.** The real hardcoded
  default is `"fontFamily": "Helvetica Neue"` (`references/recipes.md:18`). `Menlo` as a
  `fontFamily` value exists only in Rust sources — `bay-agent/src/plan.rs:2688`,
  `bay-project/tests/model.rs:923`, `bay-mcp/tests/style_kits.rs:128` — which are not "the
  instructions it was following".

The plate welded a real value onto an unrelated citation. For a video whose entire premise is
"here are the receipts, in our own text", a fabricated citation is the one thing it cannot ship.
Rewritten: every line in `code.png` and `code_scroll.png` is now a verbatim substring of the file
and line named directly above it, taken from the repo at `HEAD` (`396ead5`):

```
references/recipes.md:17     "content": "One idea.", "fontSize": 96, "color": "#EDECE6",
references/recipes.md:18     "fontFamily": "Helvetica Neue", "fontWeight": 700,
references/layout.md:50      | Role | `fontSize` | On screen |   (the type ramp, with literal numbers)
references/charts.md:17      { "id": "bar", … "color": "#FF5B5B", "radius": 0.5,
```

`recipes.md:17-18` is the stronger receipt anyway: one worked example that hardcodes **all four**
parameters at once, which is exactly what beat 11 stacks.

### 4.7 Beat 9's `5 FILES` is 4

Instruction files at `HEAD` carrying a concrete value for `fontSize` / `fontFamily` /
`fontWeight` / `color`: **`charts.md`, `layout.md`, `recipes.md`, `tools.md` — four.** Not five.
Per-parameter: `fontSize` in 3 files, `color` in 3, `fontFamily` in 2, `fontWeight` in 2.
The on-screen string in beat 9 must read `4 FILES`.

(Note: the skill is being restructured by another agent right now — `layout.md`, `recipes.md` and
`charts.md` are absent from the working tree, which holds only `craft.md`, `structure.md`,
`tools.md`. All citations above are against `HEAD`, which is what the brief was written from and
what the failed video was actually rendered under.)

### 4.8 Brief B's `√area ≥ 0.26` floppy floor clears, with 7.4 % to spare

Measured, not assumed. `floppy.png` is 38.94 % ink; placed at the brief's 0.60 of frame width its
ink lands **0.2808** — clears 0.26. Break-even is a placement of **0.556**, so the margin is
7.4 %. Do not shrink the floppy below 0.56 in beat 1. (Reading "0.60 of frame width" as the ink
bbox rather than the PNG canvas gives 0.3598, clearing comfortably; the conservative reading is
quoted.) Making it filled rather than stroked was the right call — at a typical outline density
it would have missed.

### 4.9 Brief B's `mic.fill` / `doc.fill` / `doc.text.fill` correction is half right

They are absent from `symbol_order.plist` (all 8,302 names), but `NSImage(systemSymbolName:)`
**resolves all three** and returns real, distinct glyphs — verified by SHA-1 of the rendered
pixels. They are legacy aliases, not missing symbols. `document.fill` / `text.page.fill` /
`microphone.fill` are the canonical names and should still be preferred, but code that uses the
old names will not fail.

**The floppy finding stands and is confirmed independently**: zero hits for
`floppy` / `disk` / `diskette` across all 8,302 names, and `NSImage` rejects `floppydisk`,
`floppy.disk` and `floppy.disk.fill` with `no such symbol`. Brief B is right to author one.

### 4.10 Numbers Brief C asserts, checked against the pixels

All three hold:

| claim | measured |
|---|---|
| panel is `34.2 %` of frame | **34.17 %** — 984×720 px at x 0.0444–0.9556, y 0.3333–0.7083 |
| panel:ground contrast `1.10 : 1` | **1.096 : 1** — panel `(23,24,32)`, ground `(13,13,18)` |
| `w_0.5.png` is the 0.08 % hook | **0.06 %** ink, and it is black but for a tick strip top-left |

Beat 2 draws its accent outline "at its actual bounds" — those bounds are **x 0.0444–0.9556,
y 0.3333–0.7083**, centre (0.4995, 0.5206), 0.9111 × 0.3750 of frame.

The brief says the bottom "~40 %" of `w_30.0.png` is empty; measured, the last row with ink is
y = 1359, so **29.2 %** is empty. Still a dead third, but 40 % overstates it.

### 4.11 Frames were opened and read, not just written

- `w_30.0.png` — panel is a rectangle barely separable from the ground, headline "Same range. /
  Different day.", dead bottom third. Confirmed.
- `w_18.9.png` — the card renders **empty**, gridlines and nothing else, and the headline reads
  only "Same range." with "Different day." occluded by the card sliding over it. Confirmed; this
  is the receipt the video is about.
- `w_0.5.png` — black but for a tick strip top-left. Confirmed.
- `o3_25.png` — a legible composition with a green/red diagram and a caption cut off mid-phrase
  ("and claws all the"). Serves beat 5: the predecessor genuinely reads better.

ffmpeg's input-side `-ss` was checked for frame accuracy against output-side `-ss` at both
timestamps — **byte-identical**, so the fast seek landed on the right frame.

## 5. Optional ground

```bash
ffmpeg -y -f lavfi -i "gradients=s=1080x1920:c0=0x14141C:c1=0x0A0A0E:x0=0:y0=0:x1=200:y1=1920:type=linear" \
  -vf "noise=alls=9:allf=t+u,vignette=PI/4.2,format=rgb24" -frames:v 1 bp_grain.png
```

1080×1920, no alpha, luminance 0–18, σ = 4.28 — a real gradient plus grain, not a flat fill.
Not mandated: `50-PLAN.md` §7 forbids requiring a non-flat background.

## 6. Regenerating everything

```bash
cd /Users/himanshu/codes/synthai/vii/assets/round2
swiftc -O tools/sfsym.swift -o tools/sfsym
for n in phone.fill envelope.fill folder.fill magnifyingglass bookmark.fill scissors cloud.fill; do
  o=$(echo $n | sed 's/\.fill//;s/magnifyingglass/mag/')
  tools/sfsym $n 512 "#EDECE6" $o.png --flood
  [ "$o" != cloud ] && tools/sfsym $n 256 "#EDECE6" at256/$o.png --flood
done
sips -s format png svg/floppy.svg  --out floppy.png
sips -s format png svg/oxmarks.svg --out oxmarks.png
python3 tools/mkplates.py
for f in strike strike_color strike_fontWeight strike_fontFamily oxmarks; do
  python3 tools/tightcrop.py $f.png tight/$f.png 8
done
ffmpeg -y -ss 30.0 -i ~/Desktop/wicks-v2.mp4          -frames:v 1 w_30.0.png
ffmpeg -y -ss 18.9 -i ~/Desktop/wicks-v2.mp4          -frames:v 1 w_18.9.png
ffmpeg -y -ss  0.5 -i ~/Desktop/wicks-v2.mp4          -frames:v 1 w_0.5.png
ffmpeg -y -ss 25.0 -i ~/Desktop/candlestick-wicks.mp4 -frames:v 1 o3_25.png
python3 tools/inkmeasure.py *.png at256/*.png tight/*.png
```

31 PNGs. All open, all carry alpha where they should, **none blank** — checked by reading the
alpha and luminance extrema of every file, since a silently-empty PNG is the exact failure that
produced two empty cards in the video being replaced.
