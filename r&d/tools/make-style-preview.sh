#!/bin/zsh
# make-style-preview.sh <style-id> <before.mp4> <after.mp4> <start-seconds> [side|fade]
# Writes resources/styles/<id>/preview.webm (4 s, 640×360, VP9, no audio, loops) and poster.webp,
# the files the agent panel's style tiles read (see resources/styles/README.md).
#   side: before and after side by side (for vertical edits), labels "raw" / "bay"
#   fade: before for 1.5 s, cross-fading into after (for 16:9 edits)
# Needs Homebrew ffmpeg (libvpx-vp9) and cwebp.
set -eu
ID=$1; BEFORE=$2; AFTER=$3; SS=$4; MODE=${5:-side}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; OUT="$ROOT/resources/styles/$ID"; mkdir -p "$OUT"
FF=${FFMPEG:-/opt/homebrew/bin/ffmpeg}; D=4
if [ "$MODE" = side ]; then
  FILTER="[0:v]trim=start=$SS:duration=$D,setpts=PTS-STARTPTS,scale=-2:340,setsar=1[b];[1:v]trim=start=$SS:duration=$D,setpts=PTS-STARTPTS,scale=-2:340,setsar=1[a];color=c=0x111111:s=640x360:d=${D}[bg];[bg][b]overlay=x=(W/2-w)-12:y=10[t];[t][a]overlay=x=W/2+12:y=10,format=yuv420p"
else
  FILTER="[0:v]trim=start=$SS:duration=$D,setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[b];[1:v]trim=start=$SS:duration=$D,setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[a];[b][a]xfade=transition=fade:duration=0.8:offset=1.2,format=yuv420p"
fi
"$FF" -loglevel error -y -i "$BEFORE" -i "$AFTER" -filter_complex "$FILTER" -an -t $D -c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -r 30 "$OUT/preview.webm"
"$FF" -loglevel error -y -ss 3.2 -i "$OUT/preview.webm" -frames:v 1 "$OUT/poster.png"
cwebp -quiet -q 82 "$OUT/poster.png" -o "$OUT/poster.webp"; rm -f "$OUT/poster.png"
ls -la "$OUT"
