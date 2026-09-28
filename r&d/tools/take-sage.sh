#!/bin/zsh
# take-sage.sh <name> <window> <seconds> — render one Sage take deterministically (virtual clock,
# 2 sub-frames of motion blur) at 2880×1620 from Sage's dev build. env: OUT (dir), SUB, W/H, BASE.
T="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HOME/Movies/bay-rnd/sage/takes}"; mkdir -p "$OUT/clicks"
name=$1; win=$2; secs=$3; file=${4:-$name}
tmp="$OUT/.rendering-$file.mp4"   # render aside, then move into place (never truncate a file bay may be reading)
node "$T/render-frames.mjs" --url "${BASE:-http://localhost:1420}/?window=$win" --out "$tmp" --seconds "$secs" \
  --width "${W:-2880}" --height "${H:-1620}" --fps 60 --sub "${SUB:-2}" --quality 90 \
  --before "$T/timeline-sync.js" --before "$T/film.js" --before "$T/takes-sage.js" \
  --setup "__takes.setup('$name')" \
  --run "__takes['$name']().then(() => __film.log)" --log "$OUT/clicks/$file.json" && mv -f "$tmp" "$OUT/$file.mp4"
