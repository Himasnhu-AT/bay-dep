#!/usr/bin/env bash
# Builds the ffmpeg and ffprobe bay ships, from pinned source, as LGPL-2.1.
#
#   script/build-ffmpeg.sh            # this machine's arch (arm64 on Apple silicon)
#   script/build-ffmpeg.sh x64        # cross-build the Intel binaries on Apple silicon
#   script/build-ffmpeg.sh arm64 x64  # both
#
# Output: vendor/ffmpeg/darwin-<arch>/{ffmpeg,ffprobe,BUILDINFO}. The binaries are gitignored and
# BUILDINFO is checked in — it is the record of exactly what a release carries (version, the
# configure line, the source hashes, the host toolchain, the binaries' own hashes), and a diff in
# it is how a reviewer sees that an ffmpeg change happened. `vendor/ffmpeg/LICENSES/` holds every
# licence the binaries are under and ships inside the app beside them.
#
# Why build rather than take a prebuilt: the one bay carried (npm ffmpeg-ffprobe-static 6.1.1) was
# configured `--enable-gpl --enable-nonfree`, which makes it legally unredistributable, and was
# 2.5 years of security fixes behind. Every build of it that exists anywhere is somebody else's
# configure line; this is ours, and it is the source-offer the LGPL asks for.
#
# What is in it, and why each thing is (see also vendor/ffmpeg/README.md):
#   - FFmpeg 8.1.3 (the newest 8.x; tarball GPG-verified against FFmpeg's release key
#     FCF986EA15E6E293A5644F10B4322F04D67658D8 when the hash below was pinned)
#   - libvpx   — VP9 export (webm). BSD-3 + patent grant.
#   - opus     — Opus audio for webm export. BSD-3.
#   - lame     — MP3 export. LGPL-2.0+.
#   - zimg     — `zscale`, the exact BT.709 decode the colour tests and probes measure with. WTFPL.
#   - dav1d    — AV1 import (ffmpeg's own AV1 decoder is hardware-only). BSD-2.
#   - VideoToolbox / AudioToolbox — H.264/HEVC/ProRes encode and `aac_at` (system frameworks).
# What is deliberately NOT in it:
#   - libx264/libx265/libvidstab/postproc and every `--enable-gpl` filter: GPL. H.264 export is
#     `h264_videotoolbox`; stabilisation is the LGPL `deshake` filter.
#   - the network: `--disable-network`, and only the `file` and `pipe` protocols. bay is local-only
#     (CLAUDE.md), and src/main/media/local-only.test.ts pins that no URL can be reached.
#   - devices (avfoundation would be a camera/microphone path bay never uses).
#   - libass/freetype/harfbuzz/fribidi: bay draws every glyph itself (compositions, .brf, text
#     items) and never asks ffmpeg for `drawtext` or `subtitles`; a font stack is attack surface
#     for no feature.
#
# Host requirements (recorded into BUILDINFO, not pinned): Xcode command-line tools (clang, ld,
# lipo, codesign), make, pkg-config, autoconf+automake+libtool (for zimg), ninja, python3.
# nasm (x86 asm, x64 builds only) and meson (dav1d) are built from pinned source here.
set -euo pipefail

here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"

FFMPEG_VERSION=8.1.3
MACOS_MIN=12.0 # Electron 38+ needs macOS 12; nothing here needs newer.

# name | url | sha256 — every archive is refused unless it hashes to exactly this.
SOURCES=(
  "ffmpeg-8.1.3.tar.xz|https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz|7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3"
  "libvpx-1.17.0.tar.gz|https://github.com/webmproject/libvpx/archive/refs/tags/v1.17.0.tar.gz|1020f184046187baa2985dbde38e0691f49c44088bca7a1842b0236c6081dc0a"
  "opus-1.6.1.tar.gz|https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz|6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1"
  "lame-3.100.tar.gz|https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz|ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e"
  "zimg-3.0.6.tar.gz|https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz|be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577"
  "dav1d-1.5.4.tar.xz|https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz|686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5"
  "nasm-2.16.03.tar.xz|https://www.nasm.us/pub/nasm/releasebuilds/2.16.03/nasm-2.16.03.tar.xz|1412a1c760bbd05db026b6c0d1657affd6631cd0a63cddb6f73cc6d4aa616148"
  "meson-1.12.1.tar.gz|https://github.com/mesonbuild/meson/releases/download/1.12.1/meson-1.12.1.tar.gz|ab0a6ca09f8ef70c564c8241fb5a23957886a0b53fb58412b5e07eaf07dba743"
)

# What bay (and the agent tools being built on it) needs from this binary. The build fails if any
# is missing — a missing filter must stop a release here, not surface as a failed export on a
# user's machine. src/main/ffmpeg/capabilities.test.ts holds the same line against the code's own
# argument builders, so it cannot drift from what the code actually asks for.
REQUIRED_ENCODERS="h264_videotoolbox hevc_videotoolbox prores_videotoolbox prores_ks libvpx-vp9 png mjpeg aac_at aac libopus libmp3lame pcm_s16le pcm_f32le rawvideo"
REQUIRED_DECODERS="h264 hevc prores vp8 vp9 libdav1d mjpeg png webp gif aac mp3 opus vorbis flac alac pcm_s16le pcm_s24le pcm_f32le"
REQUIRED_FILTERS="scale zscale format fps select tile trim pad setsar ebur128 alimiter aresample volume amix adelay atrim apad aformat asetpts concat loudnorm afftdn arnndn silencedetect scdet metadata deshake lut3d haldclut xfade sidechaincompress showinfo pan atempo areverse"
REQUIRED_MUXERS="mp4 mov webm matroska wav mp3 image2 rawvideo s16le f32le null ipod adts"
REQUIRED_DEMUXERS="mov matroska mp3 wav aac flac ogg image2 rawvideo lavfi concat"

log() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\nbuild-ffmpeg: %s\n' "$*" >&2; exit 1; }

for tool in clang make pkg-config autoreconf ninja python3 lipo codesign shasum; do
  command -v "$tool" >/dev/null || die "needs $tool on PATH (see the host requirements at the top of this file)"
done
command -v glibtoolize >/dev/null || command -v libtoolize >/dev/null || die "needs libtool (glibtoolize)"

CACHE="$here/.ffmpeg-build/sources"

# `--source-bundle`: the LGPL's corresponding source for a release, as one archive to publish next
# to the app (NOTICE promises it): every pinned source archive, this script, the licences and the
# BUILDINFO of each arch that has been built. Nothing is compiled.
if [ "${1:-}" = --source-bundle ]; then
  fetch_only=1
else
  fetch_only=0
fi

ARCHES=("$@")
[ $fetch_only = 1 ] && ARCHES=()
if [ ${#ARCHES[@]} -eq 0 ]; then
  case "$(uname -m)" in arm64) ARCHES=(arm64) ;; x86_64) ARCHES=(x64) ;; *) die "unsupported host $(uname -m)" ;; esac
fi

TOOLS="$here/.ffmpeg-build/tools"
JOBS=$(sysctl -n hw.ncpu)
mkdir -p "$CACHE" "$TOOLS"

# Reproducibility: no archive timestamps from ar/ld, a fixed epoch, no build paths in objects.
export ZERO_AR_DATE=1
export SOURCE_DATE_EPOCH=1758412800 # 2025-09-21, fixed; ffmpeg embeds no date anyway
export MACOSX_DEPLOYMENT_TARGET=$MACOS_MIN

fetch() {
  local entry name url sha
  for entry in "${SOURCES[@]}"; do
    IFS='|' read -r name url sha <<<"$entry"
    if [ ! -f "$CACHE/$name" ]; then
      echo "fetching $name"
      curl -fsSL --retry 3 -o "$CACHE/$name.part" "$url"
      mv "$CACHE/$name.part" "$CACHE/$name"
    fi
    echo "$sha  $CACHE/$name" | shasum -a 256 -c --status - || {
      mv "$CACHE/$name" "$CACHE/$name.bad"
      die "$name does not hash to the pinned $sha (moved aside to $name.bad)"
    }
  done
}

unpack() { # archive-name dest-dir
  /bin/rm -rf "$2"
  mkdir -p "$2"
  tar xf "$CACHE/$1" -C "$2" --strip-components 1
}

build_tools() {
  if [ ! -x "$TOOLS/bin/nasm" ]; then
    log "nasm (host tool)"
    unpack nasm-2.16.03.tar.xz "$TOOLS/src/nasm"
    (cd "$TOOLS/src/nasm" && ./configure --prefix="$TOOLS" >/dev/null && make -j"$JOBS" >/dev/null && make install >/dev/null)
  fi
  if [ ! -f "$TOOLS/meson/meson.py" ]; then
    log "meson (host tool)"
    unpack meson-1.12.1.tar.gz "$TOOLS/meson"
  fi
}

build_arch() {
  local arch=$1 carch host vpxtarget ffarch cross=()
  case "$arch" in
    arm64) carch=arm64; host=aarch64-apple-darwin; vpxtarget=arm64-darwin21-gcc; ffarch=aarch64 ;;
    x64) carch=x86_64; host=x86_64-apple-darwin; vpxtarget=x86_64-darwin21-gcc; ffarch=x86_64 ;;
    *) die "unknown arch $arch (arm64 | x64)" ;;
  esac
  local work="$here/.ffmpeg-build/$arch"
  local deps="$work/deps"
  local out="$here/vendor/ffmpeg/darwin-$arch"
  local started=$SECONDS
  # BAY_FFMPEG_KEEP_DEPS=1 reuses this arch's dependencies from an earlier complete run and rebuilds
  # only ffmpeg — for iterating on the configure line. A release build should not set it.
  local keep_deps=0
  if [ "${BAY_FFMPEG_KEEP_DEPS:-}" = 1 ] && [ -f "$deps/.complete" ]; then
    keep_deps=1
    /bin/rm -rf "$work/src/ffmpeg"
  else
    /bin/rm -rf "$work"
  fi
  mkdir -p "$deps" "$out"

  local flags="-arch $carch -mmacosx-version-min=$MACOS_MIN -O2 -ffile-prefix-map=$work=."
  export CC="clang" CXX="clang++"
  export CFLAGS="$flags" CXXFLAGS="$flags" LDFLAGS="-arch $carch -mmacosx-version-min=$MACOS_MIN"
  # Only our own .pc files: a Homebrew library found here would be linked in silently.
  export PKG_CONFIG_LIBDIR="$deps/lib/pkgconfig"
  unset PKG_CONFIG_PATH CPATH LIBRARY_PATH
  export PATH="$TOOLS/bin:$PATH"
  local build_triplet
  build_triplet=$( [ "$(uname -m)" = arm64 ] && echo aarch64-apple-darwin || echo x86_64-apple-darwin )
  local autotools=(--host="$host" --build="$build_triplet" --prefix="$deps" --disable-shared --enable-static)

  # Each dependency's output goes to its own log; on failure the tail is printed and the build stops.
  step() { # name dir command...
    local name=$1 dir=$2
    shift 2
    (cd "$dir" && "$@") >>"$work/$name.log" 2>&1 || { tail -40 "$work/$name.log"; die "$name failed (full log: $work/$name.log)"; }
  }
  # bash 3.2 (macOS's /bin/bash) calls an empty array unbound under `set -u`; `${a[@]+"${a[@]}"}`
  # expands to nothing instead.

  if [ $keep_deps = 0 ]; then
  log "[$arch] lame"
  unpack lame-3.100.tar.gz "$work/src/lame"
  # lame 3.100 exports a symbol it no longer defines; harmless for a static lib, fatal for ld.
  sed -i '' '/lame_init_old/d' "$work/src/lame/include/libmp3lame.sym"
  step lame "$work/src/lame" ./configure "${autotools[@]}" --disable-frontend --disable-decoder --disable-gtktest
  step lame "$work/src/lame" make -j"$JOBS"
  step lame "$work/src/lame" make install

  log "[$arch] opus"
  unpack opus-1.6.1.tar.gz "$work/src/opus"
  step opus "$work/src/opus" ./configure "${autotools[@]}" --disable-doc --disable-extra-programs
  step opus "$work/src/opus" make -j"$JOBS"
  step opus "$work/src/opus" make install

  log "[$arch] zimg"
  unpack zimg-3.0.6.tar.gz "$work/src/zimg"
  step zimg "$work/src/zimg" env LIBTOOLIZE="$(command -v glibtoolize || command -v libtoolize)" ./autogen.sh
  step zimg "$work/src/zimg" ./configure "${autotools[@]}"
  step zimg "$work/src/zimg" make -j"$JOBS"
  step zimg "$work/src/zimg" make install

  log "[$arch] libvpx"
  unpack libvpx-1.17.0.tar.gz "$work/src/libvpx"
  local vpxas=()
  [ "$arch" = x64 ] && vpxas=(--as=nasm)
  step libvpx "$work/src/libvpx" ./configure --target="$vpxtarget" --prefix="$deps" ${vpxas[@]+"${vpxas[@]}"} \
    --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-pic \
    --enable-vp9-highbitdepth --disable-shared --enable-static
  step libvpx "$work/src/libvpx" make -j"$JOBS"
  step libvpx "$work/src/libvpx" make install

  log "[$arch] dav1d"
  unpack dav1d-1.5.4.tar.xz "$work/src/dav1d"
  local meson_cross=()
  if [ "$carch" != "$(uname -m)" ]; then
    cat >"$work/cross.ini" <<EOF
[binaries]
c = 'clang'
cpp = 'clang++'
ar = 'ar'
strip = 'strip'
nasm = '$TOOLS/bin/nasm'
pkg-config = 'pkg-config'
[built-in options]
c_args = ['-arch', '$carch', '-mmacosx-version-min=$MACOS_MIN']
c_link_args = ['-arch', '$carch', '-mmacosx-version-min=$MACOS_MIN']
[host_machine]
system = 'darwin'
cpu_family = '$( [ "$carch" = arm64 ] && echo aarch64 || echo x86_64 )'
cpu = '$carch'
endian = 'little'
EOF
    meson_cross=(--cross-file "$work/cross.ini")
  fi
  step dav1d "$work/src/dav1d" python3 "$TOOLS/meson/meson.py" setup build ${meson_cross[@]+"${meson_cross[@]}"} \
    --prefix="$deps" --libdir=lib --buildtype=release --default-library=static \
    -Denable_tools=false -Denable_tests=false -Denable_examples=false
  step dav1d "$work/src/dav1d" ninja -C build -j"$JOBS"
  step dav1d "$work/src/dav1d" ninja -C build install
  touch "$deps/.complete"
  else
    log "[$arch] reusing dependencies from $deps (BAY_FFMPEG_KEEP_DEPS=1)"
  fi

  log "[$arch] ffmpeg $FFMPEG_VERSION"
  unpack "ffmpeg-$FFMPEG_VERSION.tar.xz" "$work/src/ffmpeg"
  [ "$carch" != "$(uname -m)" ] && cross=(--enable-cross-compile)
  local ffasm=()
  [ "$arch" = x64 ] && ffasm=(--x86asmexe=nasm)
  # The configure line is embedded in the binary (`ffmpeg -buildconf`), so it carries no paths:
  # dependency locations come in through PKG_CONFIG_LIBDIR, and for lame (which ships no .pc
  # file) through clang's own CPATH/LIBRARY_PATH — never -I/-L on the configure line.
  # `--extra-libs=-liconv`: with --disable-autodetect, configure probes only for an iconv inside
  # libc, finds none on macOS (it is the OS's libiconv), keeps iconv enabled anyway, and the link
  # then fails on `_iconv_open`. The library is the OS's, so this adds no dependency.
  export CPATH="$deps/include" LIBRARY_PATH="$deps/lib"
  (cd "$work/src/ffmpeg" && ./configure \
    --prefix=/opt/bay-ffmpeg \
    --arch="$ffarch" --target-os=darwin ${cross[@]+"${cross[@]}"} ${ffasm[@]+"${ffasm[@]}"} \
    --cc=clang --cxx=clang++ \
    --extra-cflags="-arch $carch -mmacosx-version-min=$MACOS_MIN" \
    --extra-ldflags="-arch $carch -mmacosx-version-min=$MACOS_MIN" \
    --pkg-config=pkg-config --pkg-config-flags=--static \
    --disable-autodetect \
    --disable-gpl --disable-version3 --disable-nonfree \
    --enable-static --disable-shared \
    --disable-doc --disable-htmlpages --disable-manpages --disable-podpages --disable-txtpages \
    --disable-ffplay --disable-debug \
    --disable-network --disable-protocols --enable-protocol=file,pipe \
    --disable-devices --enable-indev=lavfi \
    --enable-pthreads --enable-zlib --enable-bzlib --enable-iconv --extra-libs=-liconv \
    --enable-videotoolbox --enable-audiotoolbox \
    --enable-libvpx --enable-libopus --enable-libmp3lame --enable-libzimg --enable-libdav1d \
    >"$work/ffmpeg-configure.log" 2>&1 || { tail -30 "$work/ffmpeg-configure.log"; tail -40 "$work/src/ffmpeg/ffbuild/config.log"; die "ffmpeg configure failed"; }
  )
  (cd "$work/src/ffmpeg" && make -j"$JOBS" >"$work/ffmpeg-make.log" 2>&1) || { tail -40 "$work/ffmpeg-make.log"; die "ffmpeg build failed"; }

  log "[$arch] verify"
  local bin
  for bin in ffmpeg ffprobe; do
    /bin/cp -f "$work/src/ffmpeg/$bin" "$out/$bin"
    strip -x "$out/$bin"
    # strip invalidates the linker's ad-hoc signature, and Apple silicon kills an unsigned binary.
    codesign --force --sign - "$out/$bin" >/dev/null 2>&1
    lipo -archs "$out/$bin" | grep -qx "$carch" || die "$bin is $(lipo -archs "$out/$bin"), not $carch"
    # Nothing but the OS: a stray dylib is a library we did not pin, and one the app does not ship.
    if otool -L "$out/$bin" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)'; then
      die "$bin links a library outside the OS (listed above)"
    fi
  done

  local runnable=1
  "$out/ffmpeg" -hide_banner -version >/dev/null 2>&1 || runnable=0
  if [ $runnable = 1 ]; then
    local licence
    # -L wraps its text mid-phrase ("GNU Lesser General Public\nLicense"), so join it first.
    licence=$("$out/ffmpeg" -hide_banner -L | tr -s ' \n' '  ')
    echo "$licence" | grep -q "GNU Lesser General Public License" || die "ffmpeg -L does not say LGPL"
    if echo "$licence" | grep -q "GNU General Public License"; then die "ffmpeg -L says GPL"; fi
    echo "$licence" | grep -q "version 2.1" || die "ffmpeg -L is not LGPL version 2.1"
    local missing=""
    check() { # kind list
      local listing name
      # Codec and filter lines are "<flags> <name> …"; format lines are fixed-width flag columns
      # (" D d lavfi" — the "d" marks a device), so the name starts at column 6.
      case "$1" in
        muxers | demuxers) listing=$("$out/ffmpeg" -hide_banner "-$1" 2>/dev/null | cut -c6- | awk '{print $1}') ;;
        *) listing=$("$out/ffmpeg" -hide_banner "-$1" 2>/dev/null | awk '{print $2}') ;;
      esac
      for name in $2; do
        echo "$listing" | tr ',' '\n' | grep -qx -- "$name" || missing="$missing $1:$name"
      done
    }
    check encoders "$REQUIRED_ENCODERS"
    check decoders "$REQUIRED_DECODERS"
    check filters "$REQUIRED_FILTERS"
    check muxers "$REQUIRED_MUXERS"
    check demuxers "$REQUIRED_DEMUXERS"
    [ -z "$missing" ] || die "the build lacks:$missing"
    local protocols
    protocols=$("$out/ffmpeg" -hide_banner -protocols | sed -n '/Input:/,$p' | grep -vE 'Input:|Output:' | awk '{print $1}' | sort -u | tr '\n' ' ')
    [ "$protocols" = "file pipe " ] || die "protocols are '$protocols', expected exactly file and pipe"
  else
    echo "note: $arch binaries cannot run on this host (no Rosetta?) — capability checks skipped for them"
  fi

  local seconds=$((SECONDS - started))
  write_buildinfo "$arch" "$out" "$work" "$seconds" "$runnable" "$keep_deps"
  log "[$arch] done in ${seconds}s → $out"
  ls -l "$out"
}

write_buildinfo() {
  local arch=$1 out=$2 work=$3 seconds=$4 runnable=$5 kept=$6 entry name url sha
  {
    echo "# vendor/ffmpeg/darwin-$arch — written by script/build-ffmpeg.sh; do not edit by hand."
    echo "# Rebuild: script/build-ffmpeg.sh $arch"
    echo
    echo "## Sources (sha256)"
    for entry in "${SOURCES[@]}"; do
      IFS='|' read -r name url sha <<<"$entry"
      echo "$sha  $name  $url"
    done
    echo
    echo "## Host"
    echo "macOS $(sw_vers -productVersion) $(uname -m); deployment target $MACOS_MIN"
    clang --version | head -1
    echo "make: $(make --version | head -1)"
    echo "pkg-config: $(pkg-config --version)"
    echo "ninja: $(ninja --version)"
    echo "python3: $(python3 --version 2>&1)"
    echo "build time: ${seconds}s on $JOBS cores$( [ "$kept" = 1 ] && echo " (ffmpeg only: dependencies reused from an earlier run)")"
    echo
    echo "## Binaries"
    for name in ffmpeg ffprobe; do
      echo "$(shasum -a 256 "$out/$name" | awk '{print $1}')  $name  $(stat -f %z "$out/$name") bytes"
    done
    echo "(sha256 after strip and ad-hoc codesign)"
    echo
    echo "## Linked libraries"
    otool -L "$out/ffmpeg" | tail -n +2 | awk '{print $1}'
    echo
    if [ "$runnable" = 1 ]; then
      echo "## ffmpeg -version"
      "$out/ffmpeg" -hide_banner -version | grep -v "^Exiting with exit code"
      echo
      echo "## ffmpeg -buildconf"
      "$out/ffmpeg" -hide_banner -buildconf | grep -v "^Exiting with exit code"
      echo
      echo "## ffmpeg -L (first lines)"
      "$out/ffmpeg" -hide_banner -L | head -8
    else
      echo "## configure (from the build; the binaries could not run on this host)"
      head -1 "$work/src/ffmpeg/ffbuild/config.mak" || true
      grep -m1 '^FFMPEG_CONFIGURATION' "$work/src/ffmpeg/config.h" || true
    fi
  } >"$out/BUILDINFO"
}

copy_licences() {
  local lic="$here/vendor/ffmpeg/LICENSES" any="$here/.ffmpeg-build/${ARCHES[0]}/src"
  mkdir -p "$lic"
  /bin/cp -f "$any/ffmpeg/COPYING.LGPLv2.1" "$lic/FFmpeg-COPYING.LGPLv2.1"
  /bin/cp -f "$any/ffmpeg/LICENSE.md" "$lic/FFmpeg-LICENSE.md"
  /bin/cp -f "$any/libvpx/LICENSE" "$lic/libvpx-LICENSE"
  /bin/cp -f "$any/libvpx/PATENTS" "$lic/libvpx-PATENTS"
  /bin/cp -f "$any/opus/COPYING" "$lic/opus-COPYING"
  /bin/cp -f "$any/lame/COPYING" "$lic/lame-COPYING"
  /bin/cp -f "$any/zimg/COPYING" "$lic/zimg-COPYING"
  /bin/cp -f "$any/dav1d/COPYING" "$lic/dav1d-COPYING"
}

total_started=$SECONDS
fetch

if [ $fetch_only = 1 ]; then
  bundle="$here/release/ffmpeg-$FFMPEG_VERSION-source.tar"
  staging="$here/.ffmpeg-build/source-bundle/ffmpeg-$FFMPEG_VERSION-source"
  /bin/rm -rf "$staging"
  mkdir -p "$staging/sources" "$here/release"
  for entry in "${SOURCES[@]}"; do /bin/cp -f "$CACHE/${entry%%|*}" "$staging/sources/"; done
  /bin/cp -f "$here/script/build-ffmpeg.sh" "$staging/"
  /bin/cp -Rf "$here/vendor/ffmpeg/." "$staging/vendor-ffmpeg/"
  /bin/rm -f "$staging"/vendor-ffmpeg/*/ffmpeg "$staging"/vendor-ffmpeg/*/ffprobe
  tar cf "$bundle" -C "$(dirname "$staging")" "$(basename "$staging")"
  log "source bundle → $bundle ($(du -h "$bundle" | cut -f1))"
  exit 0
fi

build_tools
for a in "${ARCHES[@]}"; do build_arch "$a"; done
copy_licences
log "all done in $((SECONDS - total_started))s"
