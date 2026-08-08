#!/usr/bin/env bash
# Build the bay native editor in release mode.
#
#   ./build.sh                 the editor, then provision the speech sidecar
#   SKIP_SPEECH=1 ./build.sh   skip the Python sidecar (no narration, everything else works)
#   ./build.sh --locked        extra flags are passed through to cargo
#
# bay is one binary. `bay` opens the editor and `bay --mcp` serves the same engine headlessly,
# because a separate server executable is a second thing to keep in step for no benefit. The
# Kokoro sidecar is compiled in and unpacked on first use; the venv it runs in is not — a ~2 GB
# torch runtime stays a subprocess, never a link-time dependency.
#
# Provisioning the speech venv here is now a *developer convenience only*. The shipped app
# installs its own runtimes (bay-provision), so nothing below is a prerequisite for a user —
# and it must not become one again: a step that only runs at build time is a step someone who
# downloads bay.app never gets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT/rust"
echo "── build ──"
cargo build --release -p bay-desktop "$@"

if [ "${SKIP_SPEECH:-0}" = "1" ]; then
  echo "── speech: skipped (SKIP_SPEECH=1) ──"
else
  # Idempotent: a provisioned venv costs one interpreter start here, not a dependency resolve.
  # A failure is reported but does not fail the build — narration is optional, and an editor
  # that cannot speak is still an editor.
  "$ROOT/script/setup-speech.sh" || {
    echo "⚠ speech sidecar unavailable — narration tools will report why at call time"
  }
fi

echo
echo "Editor      : $ROOT/rust/target/release/bay"
echo "MCP server  : the same binary — bay --mcp"
echo "Runtimes    : ffmpeg and Kokoro are installed by the app on request, not by this script"
echo "Speech      : ${BAY_KOKORO_PYTHON:-$HOME/.local/share/bay/kokoro-venv/bin/python}"
echo "              sidecar script: $ROOT/script/bay-kokoro.py"
echo
echo "Register the MCP server with:"
echo "  claude mcp add --transport http bay http://127.0.0.1:7333/mcp"
echo
echo "To make something distributable:"
echo "  ./script/bundle-mac --dmg     universal bay.app + a .dmg, here"
echo "  ./script/build-windows        Windows, built on a runner and downloaded back"
