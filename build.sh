#!/usr/bin/env bash
# Build the vii native editor in release mode.
#
#   ./build.sh                 desktop app + MCP server, then provision the speech sidecar
#   SKIP_SPEECH=1 ./build.sh   skip the Python sidecar (no narration, everything else works)
#   ./build.sh --locked        extra flags are passed through to cargo
#
# vii ships two binaries and one Python sidecar:
#   vii   the GPUI desktop app
#   vii-mcp   the same engine as an MCP server, for agents
#   kokoro    text-to-speech, in its own venv — never linked, always a subprocess
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT/rust"
echo "── build: desktop + mcp ──"
# One cargo invocation so the shared dependency graph is built once rather than twice.
cargo build --release -p vii-desktop -p vii-mcp "$@"

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
echo "Desktop app : $ROOT/rust/target/release/vii"
echo "MCP server  : $ROOT/rust/target/release/vii-mcp"
echo "Speech      : ${VII_KOKORO_PYTHON:-$HOME/.local/share/vii/kokoro-venv/bin/python}"
echo "              sidecar script: $ROOT/script/vii-kokoro.py"
echo
echo "Register the MCP server with:"
echo "  claude mcp add --transport http vii http://127.0.0.1:7333/mcp"
