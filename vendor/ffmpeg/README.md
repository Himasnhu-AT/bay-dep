# vendor/ffmpeg — the ffmpeg bay ships

bay's `ffmpeg` and `ffprobe` are built from source by [`script/build-ffmpeg.sh`](../../script/build-ffmpeg.sh):
FFmpeg 8.1.3 configured **LGPL-2.1** (`--disable-gpl --disable-version3 --disable-nonfree`), static,
with no network (`--disable-network`, only the `file` and `pipe` protocols) and no capture devices.

```
vendor/ffmpeg/
  darwin-arm64/ffmpeg, ffprobe   built, gitignored
  darwin-arm64/BUILDINFO         committed: version, configure line, source hashes, host, binary hashes
  darwin-x64/…                   the same for Intel Macs (cross-built on Apple silicon)
  LICENSES/                      every licence the binaries are under; ships in the app
```

The packaged app carries all of it in `bay.app/Contents/Resources/ffmpeg/` (electron-builder
`extraResources`); `src/main/ffmpeg/vendor.ts` finds it there, or here in a checkout.

## Building

```bash
script/build-ffmpeg.sh            # this Mac's arch — about 5 minutes on an M-series machine
script/build-ffmpeg.sh arm64 x64  # both, for a release
```

Every source archive is pinned by SHA-256 in the script and refused if it differs. The script
fails the build if a component bay needs is missing, if `ffmpeg -L` is not LGPL 2.1, if the
protocol list is anything but `file pipe`, or if a binary links any library outside the OS.
`pnpm test` then checks the result against the code (`src/main/ffmpeg/capabilities.test.ts`), and
`pnpm release` refuses to package without the binaries BUILDINFO describes
(`script/check-ffmpeg-vendor.cjs`).

## Why the binaries are not committed

About 25 MB each, two per arch, replaced on every ffmpeg update: committing them puts ~100 MB of
history in every clone per bump, and git LFS would add a server-side dependency and a client
install step to a repo that has neither. A download step needs somewhere to host the binaries and
is one more thing whose integrity has to be pinned. Building from pinned source needs only the
Xcode command-line tools and a few Homebrew build tools, produces the same configure line every
time (BUILDINFO shows it), and *is* the corresponding-source offer the LGPL requires — the thing
a download would have to point back to anyway. The cost is five minutes once per machine, and
per release.

## What is in it, and what is not

| Component | Licence | Why |
|---|---|---|
| FFmpeg 8.1.3 | LGPL-2.1+ | everything; GPL parts not compiled |
| libvpx 1.17.0 | BSD-3 + patent grant | VP9 export (`.webm`) |
| opus 1.6.1 | BSD-3 | Opus audio in `.webm` |
| LAME 3.100 | LGPL-2.0+ | MP3 export |
| zimg 3.0.6 | WTFPL | `zscale` — exact BT.709 decode for measurement |
| dav1d 1.5.4 | BSD-2 | AV1 import |
| VideoToolbox / AudioToolbox | macOS system frameworks | H.264/HEVC/ProRes encode, `aac_at` |

Not in it: **libx264/libx265** (GPL — H.264 export is `h264_videotoolbox`), **vid.stab** (GPL — use
the LGPL `deshake` filter), the **network** (bay is local-only), **devices** (avfoundation), and
**libass/freetype/harfbuzz/fribidi** — bay draws all text itself and never calls `drawtext` or
`subtitles`, so a font stack would be attack surface for no feature. `arnndn` is compiled in but
needs a model file (e.g. from the BSD-licensed `GregorR/rnnoise-models`); none is shipped here.

## H.264 quality without x264 — the measurement behind `codec-args.ts`

Export quality used to be libx264 CRF 28 / 20 / 16 (draft / good / best). It is now
`h264_videotoolbox` with `-g 250`, at `-q:v` 53 / 72 / 79 on Apple silicon and at 0.1 / 0.3 / 0.45
bits per pixel on Intel, where ffmpeg refuses `-q:v` for VideoToolbox. Each value is the lowest
whose SSIM **and** PSNR against the source are at least x264's on every clip (Intel: on four of
five). Five 6-second clips, each fed as RGBA on stdin exactly as an export feeds them; metrics
against the same frames converted to BT.709 yuv420p by the encoding binary, frames aligned by
index. Measured 2026-09-24 on an M5 Pro, macOS 26.6.2; the Intel column is the x64 binary under
Rosetta on the same machine's encoder — no Intel Mac's encoder was measured.

Clips: **A** bay's own 1080×1920 export · **B** a grain-heavy 4K texture scaled to 1080p ·
**C** 360p camera footage · **D** `testsrc2` graphics 1080p · **E** a 768×1344 generated shot.
Cells are SSIM / PSNR dB / VMAF / kbps.

| | clip | x264 (old) | VT Apple silicon | VT Intel (bitrate) |
|---|---|---|---|---|
| **draft** | A | .9743 / 40.69 / 80.9 / 1701 | .9791 / 42.89 / 90.5 / 2241 | .9864 / 45.39 / 95.4 / 6356 |
| | B | .9734 / 32.11 / 85.4 / 27202 | .9754 / 34.69 / 90.1 / 32559 | **.8808 / 24.06 / 58.9** / 12623 |
| | C | .9705 / 37.99 / 81.8 / 147 | .9805 / 41.12 / 91.0 / 328 | .9891 / 43.19 / 93.5 / 711 |
| | D | .9907 / 38.78 / 90.4 / 3023 | .9954 / 43.36 / 96.5 / 5648 | .9958 / 41.86 / 95.7 / 6290 |
| | E | .9713 / 39.56 / 86.6 / 1881 | .9775 / 41.88 / 94.1 / 2417 | .9800 / 41.92 / 94.0 / 3171 |
| **good** | A | .9873 / 45.98 / 96.6 / 7055 | .9883 / 46.91 / 97.4 / 7560 | .9917 / 48.62 / 98.1 / 19078 |
| | B | .9938 / 39.76 / 94.7 / 41810 | .9951 / 42.88 / 95.6 / 55937 | **.9417 / 27.09 / 73.4** / 22252 |
| | C | .9928 / 44.75 / 95.0 / 588 | .9941 / 47.16 / 96.7 / 925 | .9972 / 50.23 / 97.6 / 2083 |
| | D | .9983 / 47.53 / 98.4 / 8531 | .9988 / 51.06 / 99.3 / 11274 | .9994 / 50.74 / 99.2 / 14741 |
| | E | .9893 / 45.64 / 97.5 / 5227 | .9898 / 46.67 / 97.7 / 6563 | .9914 / 47.16 / 97.8 / 9485 |
| **best** | A | .9902 / 47.74 / 98.0 / 12357 | .9906 / 48.42 / 98.2 / 13287 | .9932 / 49.84 / 98.4 / 28545 |
| | B | .9970 / 43.46 / 96.1 / 50554 | .9976 / 46.40 / 96.5 / 69269 | **.9728 / 30.72 / 83.9** / 33097 |
| | C | .9958 / 47.60 / 96.7 / 988 | .9964 / 49.79 / 97.6 / 1413 | .9982 / 52.78 / 98.1 / 3064 |
| | D | .9991 / 51.59 / 99.4 / 11397 | .9993 / 54.35 / 99.7 / 14301 | .9997 / 53.54 / 99.5 / 17602 |
| | E | .9921 / 47.64 / 98.2 / 7797 | .9921 / 48.43 / 98.3 / 10129 | .9935 / 48.84 / 98.3 / 14232 |

Read it as: on Apple silicon the old quality holds everywhere, for 7–57% more bits at good. On
Intel a fixed bitrate cannot follow content — grain (B) falls well short at every level and would
need ~0.7 bits per pixel, while flat graphics get more than they need. The binding cases were the
grain clip for draft and the generated shot for good and best (by 0.0002 SSIM at best). The
encoder quantises its scale: 53/54, 72/73, 76/77 produce identical files. `-g 250` replaced
VideoToolbox's default keyframe every 12 frames, which cost 3–20% more bits at equal quality;
`-bf 2`, `-prio_speed 0` and `-spatial_aq 1` changed nothing measurable.

## Platforms

Only macOS is built. `electron-builder.yml` still lists Windows and Linux targets; packaging them
fails in `beforePack` until someone adds a build for those platforms, rather than shipping an app
with no ffmpeg.
