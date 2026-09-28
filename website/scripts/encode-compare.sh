#!/usr/bin/env bash
# Encode one /compare entry's pair into public/compare/<slug>/.
#
#   scripts/encode-compare.sh [--before-audio] [--poster-at SECONDS] <slug> <before.mp4> <after.mp4>
#
# Writes, for each side (before, after):
#   <side>.av1.mp4       AV1 (libsvtav1), when this ffmpeg has it; skipped otherwise
#   <side>.h264.mp4      H.264 (libx264, else h264_videotoolbox), High profile, yuv420p
#   <side>-poster.avif   the frame at --poster-at (default 1.0s, a settled frame, not a fade-in)
#   <side>-poster.webp
# All videos get -movflags +faststart. Each side's frame is taken from its own input:
# landscape (or square) is scaled to fit 1280x720, portrait to fit 720x1280, padded
# to exactly that frame. The "before" video has no audio unless --before-audio is
# passed (and the entry says beforeSound: true). The "after" keeps its audio as AAC.
# Any output over 8 MB is deleted and the script fails; raise CRF_AV1 / CRF_H264
# (or trim the clip) and run it again.
#
# Encoders, as found on the author's Mac (2026-09-28, /opt/homebrew/bin/ffmpeg 9.0.1):
#   libsvtav1 yes, libx264 yes, h264_videotoolbox yes; no libwebp or AVIF encoder in
#   ffmpeg, so posters go through a PNG and Homebrew's `avifenc` and `cwebp`
#   (`brew install libavif webp`). The repository's own vendor/ffmpeg build is LGPL
#   with no libx264 and no libsvtav1 (see the root CLAUDE.md), so this script uses
#   the ffmpeg on PATH, or $FFMPEG if set, and never the vendored one.
#
# After it runs: set `status: "ready"` on the entry in src/lib/comparisons.ts, set
# `av1: false` if AV1 was skipped, fill the fields from the run, and `pnpm build`
# (which refuses a ready entry with a missing file).

set -euo pipefail

FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
CRF_AV1="${CRF_AV1:-38}"
CRF_H264="${CRF_H264:-24}"
LIMIT=$((8 * 1024 * 1024))

before_audio=0
poster_at=1.0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --before-audio) before_audio=1; shift ;;
    --poster-at) poster_at="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    --) shift; break ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done

if [[ $# -ne 3 ]]; then
  echo "usage: $0 [--before-audio] [--poster-at SECONDS] <slug> <before.mp4> <after.mp4>" >&2
  exit 2
fi
slug="$1"; before_in="$2"; after_in="$3"

if [[ ! "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "slug must be lowercase words joined by hyphens: $slug" >&2; exit 2
fi
for f in "$before_in" "$after_in"; do
  [[ -f "$f" ]] || { echo "no such file: $f" >&2; exit 2; }
done
for tool in "$FFMPEG" "$FFPROBE" avifenc cwebp; do
  command -v "$tool" >/dev/null || { echo "needs $tool on PATH" >&2; exit 2; }
done

encoders="$("$FFMPEG" -hide_banner -encoders 2>/dev/null)"
has() { grep -qE "^ [A-Z.]{6} $1 " <<<"$encoders"; }
if has libsvtav1; then av1=1; else av1=0; echo "note: no libsvtav1 in $FFMPEG; AV1 skipped, set av1: false on the entry"; fi
if has libx264; then
  h264=(-c:v libx264 -preset slow -crf "$CRF_H264" -profile:v high)
elif has h264_videotoolbox; then
  h264=(-c:v h264_videotoolbox -q:v 60 -profile:v high)
else
  echo "no H.264 encoder (libx264 or h264_videotoolbox) in $FFMPEG" >&2; exit 2
fi

here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/public/compare/$slug"
mkdir -p "$out"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/encode-compare-$slug-XXXXXX")"
trap '/bin/rm -rf "$scratch"' EXIT

duration() { "$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$1"; }

# Scale to fit the side's frame and pad to exactly it.
frame_filter() {
  local dims w h
  dims="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$1")"
  w="${dims%%x*}"; h="${dims##*x}"
  if [[ ! "$w" =~ ^[0-9]+$ || ! "$h" =~ ^[0-9]+$ ]]; then
    echo "cannot read the frame size of $1 (ffprobe said: $dims)" >&2; exit 2
  fi
  local fw=1280 fh=720
  if (( h > w )); then fw=720; fh=1280; fi
  echo "scale=${fw}:${fh}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${fw}:${fh}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p"
}

oversize=0
check_size() {
  local f="$1" bytes
  bytes=$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f")
  printf '  %-22s %6.2f MB\n' "$(basename "$f")" "$(echo "$bytes / 1048576" | bc -l)"
  if (( bytes > LIMIT )); then
    echo "  refused: $(basename "$f") is over 8 MB; deleted. Raise CRF_AV1/CRF_H264 or trim the clip." >&2
    /bin/rm -f "$f"
    oversize=1
  fi
}

encode_side() {
  local side="$1" in="$2" keep_audio="$3" vf audio
  vf="$(frame_filter "$in")"
  if [[ "$keep_audio" == 1 ]]; then audio=(-c:a aac -b:a 128k -ac 2); else audio=(-an); fi

  if [[ "$av1" == 1 ]]; then
    SVT_LOG=1 "$FFMPEG" -hide_banner -loglevel error -y -i "$in" -map 0:v:0 -map '0:a:0?' -vf "$vf" \
      -c:v libsvtav1 -preset 6 -crf "$CRF_AV1" -g 240 "${audio[@]}" \
      -movflags +faststart "$out/$side.av1.mp4"
    check_size "$out/$side.av1.mp4"
  else
    /bin/rm -f "$out/$side.av1.mp4"
  fi

  "$FFMPEG" -hide_banner -loglevel error -y -i "$in" -map 0:v:0 -map '0:a:0?' -vf "$vf" \
    "${h264[@]}" "${audio[@]}" -movflags +faststart "$out/$side.h264.mp4"
  check_size "$out/$side.h264.mp4"

  "$FFMPEG" -hide_banner -loglevel error -y -ss "$poster_at" -i "$in" -frames:v 1 \
    -vf "${vf%,format=yuv420p}" "$scratch/$side.png"
  avifenc -q 60 -s 4 "$scratch/$side.png" "$out/$side-poster.avif" >/dev/null
  cwebp -quiet -q 78 "$scratch/$side.png" -o "$out/$side-poster.webp"
  check_size "$out/$side-poster.avif"
  check_size "$out/$side-poster.webp"
}

db="$(duration "$before_in")"; da="$(duration "$after_in")"
if (( $(echo "d = $db - $da; if (d < 0) d = -d; d > 0.1" | bc -l) )); then
  echo "warning: before is ${db}s and after is ${da}s; the page plays them on one clock, so cut them to one length" >&2
fi

echo "public/compare/$slug/"
encode_side before "$before_in" "$before_audio"
encode_side after "$after_in" 1

if (( oversize )); then exit 1; fi
printf 'durationSec: %.1f\n' "$da"
