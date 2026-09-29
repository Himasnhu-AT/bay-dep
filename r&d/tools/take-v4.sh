#!/bin/zsh
# take-v4.sh <name> <query> <seconds> — render one v4 take deterministically (virtual clock,
# 2 sub-frames of motion blur) at 2880×1620. env: OUT (dir), SUB (default 2), W/H.
T="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HOME/Movies/redassay-launch/v4}"; mkdir -p "$OUT/clicks"
QL="${TMPDIR:-/tmp}/quick-liquid-inject.js"; [ -s "$QL" ] || node "$T/quick-liquid-inject.mjs" > "$QL"
name=$1; q=$2; secs=$3
node "$T/render-frames.mjs" --url "http://localhost:3000/demo?$q&theme=light" --out "$OUT/$name.mp4" --seconds "$secs" \
  --width "${W:-2880}" --height "${H:-1620}" --fps 60 --sub "${SUB:-2}" --quality 90 \
  --before "$T/timeline-sync.js" --before "$T/prep.js" --before "$QL" --before "$T/film.js" --before "$T/takes-v4.js" \
  --setup "__film.theme('light'); __film.fit(); __takes.setup('$name')" \
  --run "__takes['$name']().then(() => __film.log)" --log "$OUT/clicks/$name.json"
