#!/usr/bin/env bash
# Launch the vii native editor (GPUI desktop app).
#
#   ./run.sh              debug build — fastest to start
#   RELEASE=1 ./run.sh    release build — much smoother playback and decode
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "⚠ ffmpeg not found on PATH."
  echo "  Text and images still work, but video/audio decode, waveforms, probing"
  echo "  and MP4 export are all skipped. Install with:  brew install ffmpeg"
  echo
fi

echo "Launching vii…"
echo "  → 'Import Media…' to bring in a real clip (imports land on the timeline)"
echo "  → Space play/pause · ←/→ seek · s split · Cmd+Z undo"
echo "  → walkthrough: docs/native/try-it.md"
echo

cd "$ROOT/rust"
if [ "${RELEASE:-0}" = "1" ]; then
  exec cargo run --release -p vii-desktop "$@"
else
  exec cargo run -p vii-desktop "$@"
fi
