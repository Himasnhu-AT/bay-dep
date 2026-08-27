#!/usr/bin/env bash
# Run the Rust test suite (and optionally the web one).
#
#   ./test.sh              cargo fmt --check, clippy -D warnings, cargo test
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
env -u CARGO_TARGET_DIR cargo clippy "${OFFLINE[@]}" --workspace --all-targets -- -D warnings

echo "── test ──"
if [ "${STRICT:-0}" = "1" ]; then
  # Turn the graceful GPU/ffmpeg skips into hard failures for capability verification.
  BAY_REQUIRE_GPU=1 BAY_REQUIRE_FFMPEG=1 env -u CARGO_TARGET_DIR cargo test "${OFFLINE[@]}" --workspace "$@"
else
  env -u CARGO_TARGET_DIR cargo test "${OFFLINE[@]}" --workspace "$@"
fi
