#!/usr/bin/env bash
# Launch the bay native editor (GPUI desktop app).
#
#   ./run.sh              debug build — fastest to start
#   RELEASE=1 ./run.sh    release build — much smoother playback and decode
#   BUNDLE=1 ./run.sh     build and launch the real bay.app
#
# BUNDLE=1 exists because `cargo run` produces a bare Mach-O with no Info.plist, and macOS gives
# such a process no Dock icon, no app name in the menu bar, and no bundle identity. That is the
# "it doesn't look like a real app" you see in development — not a framework limitation, just a
# different artifact. Anything about the Dock, the app name, document types or signing must be
# checked this way; the plain path cannot show it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ "${BUNDLE:-0}" = "1" ]; then
  echo "Building bay.app (this is the artifact users get)…"
  "$ROOT/script/bundle-mac" --arch "$(uname -m)"
  APP="$ROOT/dist/macos/bay.app"
  [ -d "$APP" ] || { echo "bundle-mac did not produce $APP" >&2; exit 1; }
  echo "Launching $APP"
  exec open -W "$APP" --args "$@"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ℹ ffmpeg not found on PATH."
  echo "  bay can install it itself — press 'Install video tools' in the toolbar, or call the"
  echo "  runtime_install MCP tool. Until then, text and images work and anything touching"
  echo "  real footage is skipped with a message."
  echo
fi

echo "Launching bay…"
echo "  → 'Import Media…' to bring in a real clip (imports land on the timeline)"
echo "  → Space play/pause · ←/→ seek · s split · Cmd+Z undo"
echo "  → walkthrough: docs/native/try-it.md"
echo "  ℹ unbundled: no Dock icon and the menu bar says 'bay-desktop'. The menus and Cmd+Q"
echo "    work regardless; for the real app identity use  BUNDLE=1 ./run.sh"
echo

cd "$ROOT/rust"
if [ "${RELEASE:-0}" = "1" ]; then
  exec env -u CARGO_TARGET_DIR cargo run --release -p bay-desktop "$@"
else
  exec env -u CARGO_TARGET_DIR cargo run -p bay-desktop "$@"
fi
