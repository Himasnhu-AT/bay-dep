#!/usr/bin/env bash
# Run the Rust test suite (and optionally the web one).
#
#   ./test.sh              cargo fmt --check, clippy -D warnings, cargo test
#   SLOW=1 ./test.sh       also run the 40 tests that drive the Kokoro sidecar or load SigLIP
#   STRICT=1 ./test.sh     also fail if the GPU or ffmpeg is unavailable instead of skipping
#   BAY_ONLINE=1 ./test.sh let cargo reach the network (needed only after changing a dependency)
#
# Runs offline by default. Cargo's `.package-cache` lock lives in $CARGO_HOME and is shared by
# every workspace this user builds, so two checkouts compiling at once take turns rather than
# running in parallel — and each one's progress stalls whenever the other holds it. That lock is
# only taken for registry access, so `--offline` sidesteps it entirely and two projects stop
# blocking each other. Cargo.lock is committed and the registry is warm, so nothing needs
# fetching; set BAY_ONLINE=1 when that stops being true.
#
# Incremental compilation is off because it buys nothing for a one-shot gate run and its cache
# reached 20 GB on this machine, which is how a disk filled up mid-session.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT/rust"

OFFLINE=(--offline)
if [ "${BAY_ONLINE:-0}" = "1" ]; then
  OFFLINE=()
fi
export CARGO_INCREMENTAL=0

echo "── fmt ──"
env -u CARGO_TARGET_DIR cargo fmt --all --check

echo "── clippy ──"
env -u CARGO_TARGET_DIR cargo clippy ${OFFLINE[@]+"${OFFLINE[@]}"} --workspace --all-targets -- -D warnings

echo "── test ──"
# 40 tests drive the Kokoro TTS sidecar or load the SigLIP model. They are `#[ignore]`d and run
# only under SLOW=1. Two reasons, and speed is the lesser one:
#
#  - They cost ~43s of the ~111s the whole suite spends executing. Real, but the gate is
#    dominated by compilation, so this is worth about 7% of wall clock. Do not expect more.
#  - They are the flaky ones. `fixes.md` entry 13: the narration tests hardcode ports 7451/7452
#    and fail whenever a `bay --mcp` is already running. A test that fails for reasons outside
#    the repository is how people learn to re-run until green, which is how a real failure gets
#    ignored.
#
# `cargo test` prints them as `ignored` in its own count, so this never reads as a pass.
# Run them before anything ships, and after touching bay-speech, bay-vision or the MCP server.
# Written as `${ARR[@]+"${ARR[@]}"}` at every use site below, not `"${ARR[@]}"`. macOS ships
# bash 3.2, where expanding an *empty* array under `set -u` is an unbound-variable error — which
# is what this script did on its first run, and what `BAY_ONLINE=1` would have done to OFFLINE.
SLOW_TESTS=()
if [ "${SLOW:-0}" = "1" ]; then
  SLOW_TESTS=(-- --include-ignored)
  echo "  running the sidecar and model tests too (SLOW=1)"
else
  echo "  ℹ 40 sidecar/model tests are ignored here — SLOW=1 ./test.sh runs them."
fi

if [ "${STRICT:-0}" = "1" ]; then
  # Turn the graceful GPU/ffmpeg skips into hard failures for capability verification.
  BAY_REQUIRE_GPU=1 BAY_REQUIRE_FFMPEG=1 env -u CARGO_TARGET_DIR cargo test ${OFFLINE[@]+"${OFFLINE[@]}"} --workspace "$@" ${SLOW_TESTS[@]+"${SLOW_TESTS[@]}"}
else
  env -u CARGO_TARGET_DIR cargo test ${OFFLINE[@]+"${OFFLINE[@]}"} --workspace "$@" ${SLOW_TESTS[@]+"${SLOW_TESTS[@]}"}
fi
