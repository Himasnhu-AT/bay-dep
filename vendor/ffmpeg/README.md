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

Only macOS is built. `electron-builder.yml` still lists Windows and Linux targets; packaging them
fails in `beforePack` until someone adds a build for those platforms, rather than shipping an app
with no ffmpeg.
